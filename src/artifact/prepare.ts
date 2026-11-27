// Reads one picture the viewer may draw and turns it into the PNG bytes the Image element takes.
//
// Every byte used comes from one read of the file, with its stat taken before and after the
// read; a change in between refuses the picture. A JPEG, or a PNG past the inline bound, is
// converted from a private copy of those same bytes, so the converter never opens the original.

import { LIMITS } from './limits.ts'
import { PNG_HEAD_BYTES, jpegDimensions, pngDimensions, sizeRefusal, sniffFormat } from './format.ts'
import type { Dimensions } from './format.ts'

export type FileInfo = {
  readonly kind: string
  readonly size: number
  readonly mtimeMs: number
  /** The path with every link and `..` resolved. */
  readonly realPath?: string
}

export type RunResult = { readonly exitCode: number; readonly stdout: string }

/** What preparing needs from the host. The Claude Code integration passes `$.fs` and `$.process`. */
export type PrepareIO = {
  /** Stat that follows links and answers the resolved path. */
  stat(path: string): Promise<FileInfo>
  /** The bytes [offset, offset + length) of a file, as base64. */
  read(path: string, offset: number, length: number): Promise<string>
  /** Runs a command by its argument vector, with no shell. */
  run(argv: readonly string[], options: { readonly stdin?: string; readonly timeoutMs: number }): Promise<RunResult>
  decode(base64: string): Uint8Array
}

/** The host commands a conversion runs, by absolute path. */
export type ConvertTools = {
  readonly mktemp: string
  readonly base64: string
  readonly sips: string
  readonly rm: string
  readonly rmdir: string
}

export const MACOS_TOOLS: ConvertTools = {
  mktemp: '/usr/bin/mktemp',
  base64: '/usr/bin/base64',
  sips: '/usr/bin/sips',
  rm: '/bin/rm',
  rmdir: '/bin/rmdir',
}

export type Picture =
  | {
      readonly ok: true
      /** PNG bytes as base64, at most LIMITS.maxInlinePngBytes decoded. */
      readonly png: string
      readonly size: Dimensions
      readonly isConverted: boolean
      /** A private folder the conversion could not remove, when there is one. */
      readonly leftBehind?: string
    }
  | { readonly ok: false; readonly reason: string; readonly leftBehind?: string }

/** A multiple of 3 bytes, so the base64 of successive reads joins into one. */
const READ_CHUNK = 3 * 1024 * 1024
/** Where a JPEG's frame size is looked for. */
const JPEG_HEAD_BYTES = 1024 * 1024
const STEP_TIMEOUT_MS = 15_000

/** Never throws: every failure, an unforeseen one included, is a refusal with a fixed reason. */
export async function preparePicture(
  path: string,
  io: PrepareIO,
  tools: ConvertTools = MACOS_TOOLS,
  limits: typeof LIMITS = LIMITS,
): Promise<Picture> {
  try {
    return await prepare(path, io, tools, limits)
  } catch {
    return refuse('the picture cannot be prepared')
  }
}

async function prepare(path: string, io: PrepareIO, tools: ConvertTools, limits: typeof LIMITS): Promise<Picture> {
  const before = await io.stat(path).catch(() => undefined)
  if (before === undefined) return refuse('the file cannot be read')
  if (before.kind !== 'file' || before.realPath === undefined || !before.realPath.startsWith('/')) {
    return refuse('not a regular file')
  }
  if (before.size <= 0) return refuse('the file is empty')
  if (before.size > limits.maxSourceBytes) return refuse(`the file is larger than ${limits.maxSourceBytes} bytes`)

  const source = await readAll(before.realPath, before.size, io).catch(() => undefined)
  if (source === undefined) return refuse('the file cannot be read')
  let bytes: Uint8Array
  try {
    bytes = io.decode(source)
  } catch {
    return refuse('the file cannot be read')
  }
  const after = await io.stat(path).catch(() => undefined)
  const isSame =
    after !== undefined &&
    bytes.length === before.size &&
    after.realPath === before.realPath &&
    after.size === before.size &&
    after.mtimeMs === before.mtimeMs
  if (!isSame) return refuse('the file changed while it was read')

  const format = sniffFormat(bytes)
  if (format === undefined) return refuse('not a PNG or JPEG')
  const size = format === 'png' ? pngDimensions(bytes) : jpegDimensions(bytes.subarray(0, JPEG_HEAD_BYTES))
  if (size === undefined) return refuse('the picture size cannot be read')
  const tooLarge = sizeRefusal(size, limits)
  if (tooLarge !== undefined) return refuse(tooLarge)

  if (format === 'png' && bytes.length <= limits.maxInlinePngBytes) {
    return { ok: true, png: source, size, isConverted: false }
  }
  return convert(source, size, io, tools, limits)
}

async function readAll(realPath: string, size: number, io: PrepareIO): Promise<string> {
  let base64 = ''
  for (let offset = 0; offset < size; offset += READ_CHUNK) {
    base64 += await io.read(realPath, offset, Math.min(READ_CHUNK, size - offset))
  }
  return base64
}

async function convert(
  source: string,
  size: Dimensions,
  io: PrepareIO,
  tools: ConvertTools,
  limits: typeof LIMITS,
): Promise<Picture> {
  const made = await io.run([tools.mktemp, '-d', '-t', 'tav'], { timeoutMs: STEP_TIMEOUT_MS }).catch(() => undefined)
  const folder = made?.stdout.trim() ?? ''
  const isFolder = folder.startsWith('/') && !folder.includes('\n')
  if (made === undefined || made.exitCode !== 0 || !isFolder) {
    const refused = refuse('no private folder for the conversion')
    // A folder named despite the failure may exist: try to remove it, and say so if it stays.
    if (!isFolder) return refused
    const isRemoved = await removeFolder(folder, [], io, tools)
    return isRemoved ? refused : { ...refused, leftBehind: folder }
  }
  const input = `${folder}/source`
  const output = `${folder}/view.png`
  let picture: Picture
  try {
    picture = await convertIn(source, size, input, output, io, tools, limits)
  } catch {
    picture = refuse('the conversion failed')
  }
  const isRemoved = await removeFolder(folder, [input, output], io, tools)
  return isRemoved ? picture : { ...picture, leftBehind: folder }
}

async function convertIn(
  source: string,
  size: Dimensions,
  input: string,
  output: string,
  io: PrepareIO,
  tools: ConvertTools,
  limits: typeof LIMITS,
): Promise<Picture> {
  const copied = await io.run([tools.base64, '-D', '-o', input], { stdin: source, timeoutMs: STEP_TIMEOUT_MS })
  if (copied.exitCode !== 0) return refuse('the conversion failed')
  // Shrink only: -Z also enlarges a smaller picture.
  const longer = Math.max(size.width, size.height)
  const shrink = longer > limits.shrinkLongerSide ? ['-Z', String(limits.shrinkLongerSide)] : []
  const converted = await io.run([tools.sips, '-s', 'format', 'png', ...shrink, input, '--out', output], {
    timeoutMs: STEP_TIMEOUT_MS,
  })
  if (converted.exitCode !== 0) return refuse('the conversion failed')
  const info = await io.stat(output)
  if (info.kind !== 'file' || info.size <= 0) return refuse('the conversion failed')
  if (info.size > limits.maxInlinePngBytes) return refuse('the converted picture is still too large')
  const png = await io.read(output, 0, info.size)
  const head = io.decode(png)
  const outSize = head.length === info.size ? pngDimensions(head.subarray(0, PNG_HEAD_BYTES)) : undefined
  if (outSize === undefined) return refuse('the conversion failed')
  return { ok: true, png, size: outSize, isConverted: true }
}

async function removeFolder(folder: string, files: readonly string[], io: PrepareIO, tools: ConvertTools): Promise<boolean> {
  const removed =
    files.length === 0
      ? { exitCode: 0 }
      : await io.run([tools.rm, '-f', ...files], { timeoutMs: STEP_TIMEOUT_MS }).catch(() => undefined)
  const emptied = await io.run([tools.rmdir, folder], { timeoutMs: STEP_TIMEOUT_MS }).catch(() => undefined)
  return removed?.exitCode === 0 && emptied?.exitCode === 0
}

function refuse(reason: string): Picture {
  return { ok: false, reason }
}
