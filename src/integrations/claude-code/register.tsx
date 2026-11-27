// The Claude Code integration: draws the PNG and JPEG files a SendUserFile call sent as
// pictures, each right under its own row of the tool result (docs/v0.1-design.md).
//
// - tool.call registers each successful SendUserFile call and its picture attachments, with
//   the file each one was then; a row with no registration (a resumed session's, say) is left
//   to the engine, and a file that is no longer the one sent is not drawn.
// - ui.render ToolResult draws the engine's rows in pieces, one ending at each picture,
//   with the picture after it. Pictures are prepared off the render, then the rows redraw.
//   A row prepares again only once its place on screen has changed, so rows evicted from
//   the cache never chase each other.
// - While it is not known whether the terminal draws pictures, the first one drawn on screen
//   is asked through $.ui.blit; two refusals in a row, each from a fresh draw, turn pictures
//   off for the session, back to the engine's rows. A terminal found to draw them stays so.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ImageSupport, RegisteredCall, RegisteredImage } from '../../../types/index.d.ts'
import { BoundedCache } from '../../artifact/cache.ts'
import { DEFAULT_FIT, fitToCells, parseCellAspect } from '../../artifact/fit.ts'
import type { FitOptions } from '../../artifact/fit.ts'
import { LIMITS } from '../../artifact/limits.ts'
import { preparePicture } from '../../artifact/prepare.ts'
import type { Picture, PrepareIO } from '../../artifact/prepare.ts'
import { attachmentsOf, imageCandidates } from '../../artifact/select.ts'

const TOOL = 'SendUserFile'
/** Registered calls kept for the session, the latest last. */
const KEPT_CALLS = 200
/** A refused picture's share of the cache, in bytes. */
const REFUSAL_BYTES = 64
/** After a picture is drawn on screen, when the terminal is asked about it; after a refusal, when again. */
const PROBE_DELAY_MS = 500
const PROBE_AGAIN_MS = 1500
/** Refusals in a row, each from a fresh draw, that turn pictures off. */
const REFUSALS_TO_STOP = 2

// Change a shape tag when its value's fields change: a value an earlier version
// stored outlives a reload, and the tag declines it.
const calls = atom({ plugin: 'terminal-artifact-viewer', key: 'calls' } as const, [] as RegisteredCall[], {
  shape: 'calls-2',
})
const support = atom({ plugin: 'terminal-artifact-viewer', key: 'support' } as const, 'unknown' as ImageSupport, {
  shape: 'support-1',
})

// Memory of this module only: a reload starts them over, which costs a new preparation.
const pictures = new BoundedCache<Picture>(LIMITS.cacheEntries, LIMITS.cacheBytes)
const preparing = new Set<string>()
/** For each call, where its row was on screen when its pictures were last prepared. */
const preparedAt = new Map<string, string>()
let isProbing = false
let refusals = 0
let isHinted = false

export const register: Register = (on, options) => {
  const fit: FitOptions = { ...DEFAULT_FIT, cellAspect: parseCellAspect(options.cellAspect) }

  on('tool.call', { tool: 'SendUserFile' }, async ($, e, next) => {
    const ran = await next(e)
    try {
      const outcome = ran as { deny?: unknown; isError?: unknown; result?: unknown }
      if (outcome.deny !== undefined || outcome.isError === true) return ran
      const images: RegisteredImage[] = []
      for (const { index, path } of imageCandidates(attachmentsOf(outcome.result) ?? [])) {
        // The file as it was sent: a later read must still find this one.
        const info = await $.fs.stat(path, { resolve: true }).catch(() => undefined)
        if (info?.kind !== 'file' || info.realPath === undefined) continue
        images.push({ index, path, realPath: info.realPath, size: info.size, mtimeMs: info.mtimeMs })
      }
      if (images.length > 0) {
        await update($, calls, list =>
          [...list.filter(call => call.id !== e.tool_use_id), { id: e.tool_use_id, images }].slice(-KEPT_CALLS),
        )
      }
    } catch {
      // The call already ran: whatever failed here only leaves its row undrawn.
    }
    return ran
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const props = e.props
    if (e.surface !== 'terminal' || props.tool !== TOOL || props.isErrored) return next(e)
    try {
      const output = props.output
      const list = attachmentsOf(output)
      const registered = (await read($, calls)).find(call => call.id === props.tool_use_id)
      if (list === undefined || registered === undefined) return next(e)
      // Off screen: whatever the cache lets go meanwhile is prepared again when the row comes back.
      if (props.onScreen === null) preparedAt.delete(props.tool_use_id)
      const supportNow = await read($, support)
      if (supportNow === 'alt') return next(e)

      // The attachments the call registered, still at the same place with the same path.
      const wanted = imageCandidates(list).flatMap(candidate => {
        const image = registered.images.find(one => one.index === candidate.index && one.path === candidate.path)
        return image === undefined ? [] : [image]
      })
      if (wanted.length === 0) return next(e)
      const found = wanted.map(candidate => ({ candidate, picture: pictures.get(pictureKey(props.tool_use_id, candidate.index)) }))
      if (found.some(item => item.picture === undefined)) {
        // Off screen (null) waits; a row the surface says nothing about may start.
        if (props.onScreen !== null) startPreparing($, props.tool_use_id, wanted, placeOnScreen(props.onScreen))
        return next(e)
      }

      const { Box, Text, Image } = $.ui.resolve(e)
      const columns = e.viewport?.columns ?? 80
      const original = (output as { attachments: readonly unknown[] }).attachments
      const parts = []
      let start = 0
      for (const { candidate, picture } of found) {
        if (picture === undefined) continue
        // The engine's rows up to and including this picture's, then the picture.
        parts.push(await next(withAttachments(e, original.slice(start, candidate.index + 1), start === 0)))
        if (picture.ok) {
          const cells = fitToCells(picture.size, columns, fit)
          parts.push(
            <Box paddingLeft={LIMITS.indent}>
              <Image
                key={`tav-${candidate.index}`}
                source={{ png: picture.png }}
                columns={cells.columns}
                rows={cells.rows}
                alt={`[image] ${candidate.path}`}
              />
            </Box>,
          )
        } else {
          parts.push(<Text dimColor>{`${' '.repeat(LIMITS.indent)}(picture not shown: ${picture.reason})`}</Text>)
        }
        start = candidate.index + 1
      }
      if (start < original.length) parts.push(await next(withAttachments(e, original.slice(start), false)))

      const first = found.find(item => item.picture?.ok === true)
      if (supportNow === 'unknown' && !isProbing && first?.picture?.ok === true && isOnScreen(props.onScreen)) {
        isProbing = true
        const cells = fitToCells(first.picture.size, columns, fit)
        const probe = { requestId: e.requestId, key: `tav-${first.candidate.index}`, source: { png: first.picture.png }, ...cells }
        $.clock.after(refusals === 0 ? PROBE_DELAY_MS : PROBE_AGAIN_MS, () => {
          void askTerminal($, probe)
        })
      }
      return <Box flexDirection="column">{parts}</Box>
    } catch {
      return next(e)
    }
  })
}

function pictureKey(toolUseId: string, index: number): string {
  return `${toolUseId}#${index}`
}

/** The event with the output's attachments narrowed to a piece; the caption stays with the first piece. */
function withAttachments<E extends { props: { output: unknown } }>(e: E, attachments: readonly unknown[], keepsCaption: boolean): E {
  const { caption, ...rest } = e.props.output as Record<string, unknown>
  const output = keepsCaption && caption !== undefined ? { ...rest, caption, attachments } : { ...rest, attachments }
  return { ...e, props: { ...e.props, output } }
}

function isOnScreen(value: unknown): boolean {
  return typeof value === 'object' && value !== null
}

/** Where a row is on screen, as a key that changes when it scrolls; absent when the surface does not say. */
function placeOnScreen(value: unknown): string {
  return value === undefined ? 'absent' : JSON.stringify(value)
}

/**
 * Prepares a call's pictures off the render, then asks every row to draw again. Once a call
 * was prepared, it is prepared again only from another place on screen: a picture the cache
 * let go comes back when its row scrolls into view, and rows do not evict each other in turn.
 */
function startPreparing($: EngineInterface, toolUseId: string, wanted: readonly RegisteredImage[], place: string): void {
  if (preparing.has(toolUseId) || preparedAt.get(toolUseId) === place) return
  preparing.add(toolUseId)
  preparedAt.set(toolUseId, place)
  const io = hostIO($)
  $.clock.after(0, () => {
    void (async () => {
      try {
        for (const candidate of wanted) {
          const expected = { realPath: candidate.realPath, size: candidate.size, mtimeMs: candidate.mtimeMs }
          const picture = await preparePicture(candidate.path, io, { expected })
          if (picture.leftBehind !== undefined) {
            $.ui.log(`terminal-artifact-viewer: could not remove the temporary folder ${picture.leftBehind}`)
          }
          pictures.set(pictureKey(toolUseId, candidate.index), picture, picture.ok ? picture.png.length : REFUSAL_BYTES)
        }
      } finally {
        preparing.delete(toolUseId)
        $.ui.invalidate('ui.render')
      }
    })()
  })
}

/** The host's files and commands, as preparing a picture needs them. */
function hostIO($: EngineInterface): PrepareIO {
  return {
    async stat(path) {
      const info = await $.fs.stat(path, { resolve: true })
      return { kind: info.kind, size: info.size, mtimeMs: info.mtimeMs, realPath: info.realPath }
    },
    async read(path, offset, length) {
      const { base64 } = await $.fs.read(path, { as: 'bytes', offset, length })
      return base64
    },
    async run(argv, options) {
      const done = await $.process.run(argv, { stdin: options.stdin, timeoutMs: options.timeoutMs })
      return { exitCode: done.exitCode, stdout: done.stdout }
    },
    decode(base64) {
      return Uint8Array.fromBase64(base64)
    },
  }
}

type Probe = { requestId: string; key: string; source: { png: string }; columns: number; rows: number }

/**
 * Swaps the picture for itself: the terminal draws pixels when the swap is taken, and refuses
 * it when the picture is drawn as its alt text. A refusal can also mean the row left the screen
 * or changed size, so the first one asks for a fresh draw, which asks again at its own size;
 * only refusals in a row turn pictures off, and never once they were found drawn.
 */
async function askTerminal($: EngineInterface, probe: Probe): Promise<void> {
  // A call that fails says nothing about the terminal: the next draw on screen asks again.
  const answer = await $.ui.blit(probe).catch(() => undefined)
  isProbing = false
  if (answer === undefined) return
  if (answer.deny === undefined) {
    refusals = 0
    await update($, support, () => 'drawn')
    return
  }
  refusals += 1
  if (refusals < REFUSALS_TO_STOP) {
    $.ui.invalidate('ui.render')
    return
  }
  await update($, support, current => (current === 'drawn' ? 'drawn' : 'alt'))
  await hintOnce($)
}

/** Inside Herdr without the variable that lets Claude Code draw pictures there, says so once. */
async function hintOnce($: EngineInterface): Promise<void> {
  if (isHinted) return
  isHinted = true
  const inHerdr = (await $.env.get('HERDR_ENV')) !== undefined
  const isForced = (await $.env.get('CLAUDE_CODE_FORCE_TERMINAL_IMAGES')) !== undefined
  if (inHerdr && !isForced) {
    // The toast is headed by the plugin's name; the text stays short enough not to be cut.
    $.ui.toast('Inside Herdr, start Claude Code with CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1 to see pictures.')
  }
}
