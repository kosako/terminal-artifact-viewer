import type { Register } from 'claude-code'

// Phase 0 probe (kept for reproduction; see docs/phase0-poc.md). It records what the render sites see (as step 1 did)
// and, under a SendUserFile result, draws each PNG or JPEG
// attachment as an Image after the engine's own rows, which stay as they are.
// One log per module load, in this plugin's own data folder (CLAUDE_PLUGIN_DATA),
// so two sessions loading the probe do not overwrite each other's log.
const LOG_NAME = `render-log-${Date.now()}.jsonl`
let logPath: string | undefined
// SendUserFile only: SendUserMessage's permission path was not read in Phase 0.
const WATCHED = new Set(['SendUserFile'])
const MAX_LINES = 400
const MAX_SOURCE_BYTES = 20 * 1024 * 1024 // refuse anything larger outright
const MAX_PNG_BYTES = 2 * 1024 * 1024 // what an Image source takes, decoded
const MAX_IMAGES_PER_ROW = 8
const CELL_ASPECT = 0.41 // cell width / cell height: 7.0 x 16.9 px measured on the PoC device
const MAX_ROWS = 24
const MAX_COLUMNS = 100

const lines: string[] = []
const seen = new Set<string>()
let writing: Promise<void> = Promise.resolve()

type Writer = {
  fs: { write: (p: string, t: string) => Promise<void> }
  process: { hookEnv: () => Promise<Record<string, string>> }
}

async function logFile($: Writer) {
  if (logPath === undefined) {
    const dir = (await $.process.hookEnv()).CLAUDE_PLUGIN_DATA
    logPath = dir === undefined ? '' : `${dir}/${LOG_NAME}`
  }
  return logPath
}

type Attachment = { path?: unknown; isImage?: unknown; media_type?: unknown; pathValidated?: unknown; size?: unknown }
type Prepared =
  | { ok: true; path: string; base64: string; width: number; height: number; via: string }
  | { ok: false; path: string; reason: string }

const cache = new Map<string, Prepared>()
const blitAsked = new Set<string>()

function attachmentsOf(output: unknown): Attachment[] | undefined {
  if (typeof output !== 'object' || output === null) return undefined
  const list = (output as { attachments?: unknown }).attachments
  return Array.isArray(list) ? (list as Attachment[]) : undefined
}

function summarize(output: unknown) {
  return attachmentsOf(output)?.map(a => ({
    path: a.path,
    isImage: a.isImage,
    media_type: a.media_type,
    pathValidated: a.pathValidated,
    size: a.size,
  }))
}

// `always` skips the line cap and the dedupe, for what must not be lost (a temp file left behind).
function record($: Writer, entry: Record<string, unknown> | undefined, always = false) {
  if (entry === undefined) return
  const key = JSON.stringify(entry)
  if (!always && (seen.has(key) || lines.length >= MAX_LINES)) return
  seen.add(key)
  lines.push(JSON.stringify({ at: new Date().toISOString(), ...entry }))
  const text = lines.join('\n') + '\n'
  writing = writing
    .then(async () => {
      const file = await logFile($)
      if (file !== '') await $.fs.write(file, text)
    })
    .catch(() => undefined)
}

function baseName(path: string) {
  const cut = path.lastIndexOf('/')
  return cut < 0 ? path : path.slice(cut + 1)
}

function pngSize(head: Uint8Array): { width: number; height: number } | undefined {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (head.length < 24 || sig.some((b, i) => head[i] !== b)) return undefined
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

// Width and height from a JPEG's first SOF segment, within the bytes given.
function jpegSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  let i = 2
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return undefined
    const marker = bytes[i + 1]
    const length = (bytes[i + 2] << 8) | bytes[i + 3]
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] }
    i += 2 + length
  }
  return undefined
}

function isJpeg(head: Uint8Array) {
  return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
}

function fit(width: number, height: number, viewportColumns: number) {
  let columns = Math.max(8, Math.min(MAX_COLUMNS, viewportColumns - 6))
  let rows = Math.max(1, Math.round(columns * (height / width) * CELL_ASPECT))
  if (rows > MAX_ROWS) {
    rows = MAX_ROWS
    columns = Math.max(1, Math.round(rows / ((height / width) * CELL_ASPECT)))
  }
  return { columns: Math.min(255, columns), rows: Math.min(255, rows) }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    record($, { event: 'session.start' })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (WATCHED.has(e.tool)) {
      const result = (ran as { result?: unknown }).result
      record($, {
        event: 'tool.call',
        tool: e.tool,
        tool_use_id: e.tool_use_id,
        denied: (ran as { deny?: string }).deny !== undefined,
        isError: (ran as { isError?: boolean }).isError,
        attachments: summarize(result),
      })
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const props = e.props as Record<string, unknown>
    if (typeof props.tool === 'string' && WATCHED.has(props.tool)) {
      record($, {
        event: 'ui.render',
        component: 'ToolUse',
        requestId: e.requestId,
        isRunning: props.isRunning,
        hasOutput: props.output !== undefined,
        viewport: e.viewport,
      })
    }
    return next(e)
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const engine = await next(e)
    const props = e.props as { tool?: string; output?: unknown; isErrored?: boolean; isExpanded?: boolean }
    if (e.surface !== 'terminal' || props.tool === undefined || !WATCHED.has(props.tool) || props.isErrored) {
      return engine
    }
    const list = (attachmentsOf(props.output) ?? []).slice(0, MAX_IMAGES_PER_ROW)
    const wanted = list.filter(
      a =>
        a.isImage === true &&
        a.pathValidated === true &&
        typeof a.path === 'string' &&
        a.path.startsWith('/') &&
        (a.media_type === 'image/png' || a.media_type === 'image/jpeg'),
    )
    if (wanted.length === 0) return engine

    const prepared: Prepared[] = []
    for (const a of wanted) {
      const path = a.path as string
      try {
        const stat = await $.fs.stat(path, { resolve: true })
        if (stat.kind !== 'file' || stat.realPath === undefined) {
          prepared.push({ ok: false, path, reason: `not a regular file (${stat.kind})` })
          continue
        }
        if (stat.size > MAX_SOURCE_BYTES) {
          prepared.push({ ok: false, path, reason: `too large (${stat.size} bytes)` })
          continue
        }
        const key = `${stat.realPath}|${stat.size}|${stat.mtimeMs}`
        const hit = cache.get(key)
        if (hit !== undefined) {
          // The key is the real file; keep the path this row named for the caption and alt.
          prepared.push({ ...hit, path })
          continue
        }
        const head = Uint8Array.fromBase64((await $.fs.read(stat.realPath, { as: 'bytes', length: 32 })).base64)
        const dims = pngSize(head)
        let made: Prepared
        if (dims !== undefined && stat.size <= MAX_PNG_BYTES) {
          const { base64 } = await $.fs.read(stat.realPath, { as: 'bytes' })
          made = { ok: true, path, base64, ...dims, via: 'png bytes' }
        } else if (dims !== undefined || isJpeg(head)) {
          // JPEG, or a PNG past the Image limit: macOS sips writes a PNG at most
          // 1600 px on its longer side into a private temp folder, read back and removed.
          const made_dir = await $.process.run(['/usr/bin/mktemp', '-d', '-t', 'tav'])
          const dir = made_dir.stdout.trim()
          if (made_dir.exitCode !== 0 || !dir.startsWith('/')) throw new Error('mktemp failed')
          const out = `${dir}/view.png`
          try {
            // Shrink only: -Z also enlarges, so it is passed only past 1600 px.
            let longer = dims === undefined ? undefined : Math.max(dims.width, dims.height)
            if (longer === undefined) {
              const lead = Uint8Array.fromBase64((await $.fs.read(stat.realPath, { as: 'bytes', length: 65536 })).base64)
              const j = jpegSize(lead)
              longer = j === undefined ? 1601 : Math.max(j.width, j.height)
            }
            const shrink = longer > 1600 ? ['-Z', '1600'] : []
            const conv = await $.process.run(
              ['/usr/bin/sips', '-s', 'format', 'png', ...shrink, stat.realPath, '--out', out],
              { timeoutMs: 15000 },
            )
            if (conv.exitCode !== 0) throw new Error(`sips exit ${conv.exitCode}`)
            const outStat = await $.fs.stat(out)
            if (outStat.size > MAX_PNG_BYTES) throw new Error(`converted PNG too large (${outStat.size})`)
            const { base64 } = await $.fs.read(out, { as: 'bytes' })
            const outDims = pngSize(Uint8Array.fromBase64(base64.slice(0, 44)))
            if (outDims === undefined) throw new Error('converted file is not a PNG')
            made = { ok: true, path, base64, ...outDims, via: 'sips' }
          } finally {
            // A failed removal leaves the converted picture behind, so record it.
            for (const argv of [['/bin/rm', '-f', out], ['/bin/rmdir', dir]]) {
              const done = await $.process.run(argv).catch(() => ({ exitCode: -1 }))
              if (done.exitCode !== 0) {
                record($, { event: 'cleanup-failed', command: argv[0], exitCode: done.exitCode, folder: dir }, true)
              }
            }
          }
        } else {
          made = { ok: false, path, reason: 'not a PNG or JPEG by its bytes' }
        }
        cache.set(key, made)
        prepared.push(made)
      } catch (error) {
        prepared.push({ ok: false, path, reason: error instanceof Error ? error.message : String(error) })
      }
    }

    const columns = e.viewport?.columns ?? 80
    record($, {
      event: 'draw',
      requestId: e.requestId,
      viewport: e.viewport,
      items: prepared.map(p =>
        p.ok ? { path: p.path, via: p.via, width: p.width, height: p.height, ...fit(p.width, p.height, columns) } : p,
      ),
    })

    if (e.surface !== 'terminal') return engine

    // Ask the terminal once per row whether the first picture is drawn as pixels
    // or as its alt: $.ui.blit denies a swap on an Image that draws its alt.
    const firstIndex = prepared.findIndex(p => p.ok)
    const first = prepared[firstIndex]
    if (first !== undefined && first.ok && !blitAsked.has(e.requestId)) {
      blitAsked.add(e.requestId)
      const size = fit(first.width, first.height, columns)
      const requestId = e.requestId
      $.clock.after(1500, () => {
        void $.ui
          .blit({ requestId, key: `tav-${firstIndex}`, source: { png: first.base64 }, ...size })
          .then(result => record($, { event: 'blit', requestId, result }))
          .catch(error => record($, { event: 'blit', requestId, error: String(error) }))
      })
    }

    const { Box, Text, Image } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {engine}
        {prepared.map((p, index) => {
          if (!p.ok) {
            return <Text dimColor>{`  (not shown: ${baseName(p.path)}: ${p.reason})`}</Text>
          }
          const size = fit(p.width, p.height, columns)
          return (
            <Box flexDirection="column" marginTop={1} paddingLeft={2}>
              <Text dimColor>{`${baseName(p.path)}  ${p.width}x${p.height}`}</Text>
              <Image
                key={`tav-${index}`}
                source={{ png: p.base64 }}
                columns={size.columns}
                rows={size.rows}
                alt={`[image] ${p.path}`}
              />
            </Box>
          )
        })}
      </Box>
    )
  })
}
