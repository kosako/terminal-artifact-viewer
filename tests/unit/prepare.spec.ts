import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { closeSync, openSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs'
import { LIMITS } from '../../src/artifact/limits.ts'
import { MACOS_TOOLS, preparePicture } from '../../src/artifact/prepare.ts'
import type { FileInfo, PrepareIO, RunResult } from '../../src/artifact/prepare.ts'

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../poc/fixtures/${name}`, import.meta.url)))
const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
const fromBase64 = (text: string) => new Uint8Array(Buffer.from(text, 'base64'))

/** The head of a PNG of the given size, padded to `length` bytes. */
function fakePng(width: number, height: number, length = 64): Uint8Array {
  const bytes = new Uint8Array(length)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return bytes
}

type FakeFile = { bytes: Uint8Array; mtimeMs: number; kind?: string; realPath?: string }

/** A host of files in memory; conversion commands act on them as the real tools would. */
class FakeHost implements PrepareIO {
  files = new Map<string, FakeFile>()
  runs: { argv: readonly string[]; stdin?: string }[] = []
  reads: { path: string; offset: number; length: number }[] = []
  statCalls = 0
  /** Changes what the next stat answers, by call number (1-based). */
  statOverride: (call: number, info: FileInfo) => FileInfo = (_, info) => info
  /** What sips writes; undefined writes nothing. */
  converted: Uint8Array | undefined = fixture('tav-fixture-wide.png')
  failing = new Set<string>()
  folder = '/fake/tmp/tav.1'
  /** The exit code mktemp answers while still naming its folder. */
  mktempExit = 0
  decodeThrows = false

  async stat(path: string): Promise<FileInfo> {
    this.statCalls += 1
    const file = this.files.get(path)
    if (file === undefined) throw new Error('no such file')
    const info = { kind: file.kind ?? 'file', size: file.bytes.length, mtimeMs: file.mtimeMs, realPath: file.realPath ?? path }
    return this.statOverride(this.statCalls, info)
  }

  async read(path: string, offset: number, length: number): Promise<string> {
    this.reads.push({ path, offset, length })
    const file = this.files.get(path)
    if (file === undefined) throw new Error('no such file')
    return toBase64(file.bytes.subarray(offset, offset + length))
  }

  async run(argv: readonly string[], options: { stdin?: string; timeoutMs: number }): Promise<RunResult> {
    this.runs.push({ argv, stdin: options.stdin })
    const [tool] = argv
    if (tool !== undefined && this.failing.has(tool)) return { exitCode: 1, stdout: '' }
    if (tool === MACOS_TOOLS.mktemp) return { exitCode: this.mktempExit, stdout: `${this.folder}\n` }
    if (tool === MACOS_TOOLS.base64) {
      this.files.set(argv[3] ?? '', { bytes: fromBase64(options.stdin ?? ''), mtimeMs: 1 })
      return { exitCode: 0, stdout: '' }
    }
    if (tool === MACOS_TOOLS.sips) {
      if (this.converted !== undefined) this.files.set(argv.at(-1) ?? '', { bytes: this.converted, mtimeMs: 1 })
      return { exitCode: 0, stdout: '' }
    }
    if (tool === MACOS_TOOLS.rm) {
      for (const path of argv.slice(2)) this.files.delete(path)
      return { exitCode: 0, stdout: '' }
    }
    return { exitCode: 0, stdout: '' }
  }

  decode(base64: string): Uint8Array {
    if (this.decodeThrows) throw new Error('bad base64')
    return fromBase64(base64)
  }

  tools(): string[] {
    return this.runs.map(run => run.argv[0] ?? '')
  }
}

function hostWith(path: string, bytes: Uint8Array, extra: Partial<FakeFile> = {}): FakeHost {
  const host = new FakeHost()
  host.files.set(path, { bytes, mtimeMs: 100, ...extra })
  return host
}

test('a small PNG is used as it is, with no command run', async () => {
  const png = fixture('tav-fixture-wide.png')
  const host = hostWith('/work/a.png', png)
  const picture = await preparePicture('/work/a.png', host)
  assert.deepEqual(picture, { ok: true, png: toBase64(png), size: { width: 640, height: 360 }, isConverted: false })
  assert.deepEqual(host.runs, [])
})

test('the resolved path is what is read', async () => {
  const host = hostWith('/work/link.png', fixture('tav-fixture-tall.png'), { realPath: '/real/tall.png' })
  host.files.set('/real/tall.png', { bytes: fixture('tav-fixture-tall.png'), mtimeMs: 100 })
  const picture = await preparePicture('/work/link.png', host)
  assert.equal(picture.ok, true)
  assert.deepEqual(new Set(host.reads.map(read => read.path)), new Set(['/real/tall.png']))
})

test('a JPEG is converted from a private copy of the bytes that were checked', async () => {
  const jpeg = fixture('tav-fixture-wide.jpg')
  const host = hostWith('/work/b.jpg', jpeg)
  const picture = await preparePicture('/work/b.jpg', host)
  assert.equal(picture.ok, true)
  assert.equal(picture.ok && picture.isConverted, true)
  assert.deepEqual(picture.ok && picture.size, { width: 640, height: 360 })
  assert.deepEqual(host.tools(), [MACOS_TOOLS.mktemp, MACOS_TOOLS.base64, MACOS_TOOLS.sips, MACOS_TOOLS.rm, MACOS_TOOLS.rmdir])
  const [, copy, convert, remove, rmdir] = host.runs
  assert.equal(copy?.stdin, toBase64(jpeg))
  assert.deepEqual(copy?.argv, [MACOS_TOOLS.base64, '-D', '-o', `${host.folder}/source`])
  // Not shrunk: the longer side is under 1600 px, and -Z would enlarge.
  assert.deepEqual(convert?.argv, [MACOS_TOOLS.sips, '-s', 'format', 'png', `${host.folder}/source`, '--out', `${host.folder}/view.png`])
  assert.ok(convert?.argv.every(arg => arg !== '/work/b.jpg'), 'the converter never opens the original')
  assert.deepEqual(remove?.argv, [MACOS_TOOLS.rm, '-f', `${host.folder}/source`, `${host.folder}/view.png`])
  assert.deepEqual(rmdir?.argv, [MACOS_TOOLS.rmdir, host.folder])
})

test('a PNG past the inline bound is shrunk to the longer-side bound', async () => {
  const big = fakePng(3000, 2000, 4096)
  const host = hostWith('/work/big.png', big)
  host.converted = fakePng(1600, 1067, 512)
  const picture = await preparePicture('/work/big.png', host, MACOS_TOOLS, { ...LIMITS, maxInlinePngBytes: 1024 })
  assert.deepEqual(picture.ok && picture.size, { width: 1600, height: 1067 })
  assert.deepEqual(host.runs[2]?.argv.slice(0, 6), [MACOS_TOOLS.sips, '-s', 'format', 'png', '-Z', '1600'])
})

test('a file over 3 MiB is read in chunks that join into one base64', async () => {
  const size = 7 * 1024 * 1024
  const big = fakePng(3000, 2000, size)
  const host = hostWith('/work/huge.png', big)
  await preparePicture('/work/huge.png', host)
  assert.deepEqual(host.reads.filter(read => read.path === '/work/huge.png').map(read => [read.offset, read.length]), [
    [0, 3 * 1024 * 1024],
    [3 * 1024 * 1024, 3 * 1024 * 1024],
    [6 * 1024 * 1024, 1024 * 1024],
  ])
  assert.equal(host.runs[1]?.stdin, toBase64(big))
})

test('files that are not to be read are refused before reading', async () => {
  const missing = await preparePicture('/work/none.png', new FakeHost())
  assert.deepEqual(missing, { ok: false, reason: 'the file cannot be read' })

  const folder = hostWith('/work/dir', new Uint8Array(1), { kind: 'directory' })
  assert.deepEqual(await preparePicture('/work/dir', folder), { ok: false, reason: 'not a regular file' })
  assert.deepEqual(folder.reads, [])

  const empty = hostWith('/work/empty.png', new Uint8Array(0))
  assert.deepEqual(await preparePicture('/work/empty.png', empty), { ok: false, reason: 'the file is empty' })

  const large = hostWith('/work/large.png', fakePng(10, 10, 2048))
  const refused = await preparePicture('/work/large.png', large, MACOS_TOOLS, { ...LIMITS, maxSourceBytes: 1024 })
  assert.equal(refused.ok, false)
  assert.deepEqual(large.reads, [])
})

test('a file that changes between the stats around the read is refused', async () => {
  for (const change of [
    (info: FileInfo) => ({ ...info, mtimeMs: info.mtimeMs + 1 }),
    (info: FileInfo) => ({ ...info, size: info.size + 1 }),
    (info: FileInfo) => ({ ...info, realPath: '/elsewhere/secret.png' }),
  ]) {
    const host = hostWith('/work/a.png', fixture('tav-fixture-wide.png'))
    host.statOverride = (call, info) => (call === 2 ? change(info) : info)
    assert.deepEqual(await preparePicture('/work/a.png', host), { ok: false, reason: 'the file changed while it was read' })
  }
})

test('content that is not a drawable PNG or JPEG is refused', async () => {
  const gif = hostWith('/work/a.png', new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]))
  assert.deepEqual(await preparePicture('/work/a.png', gif), { ok: false, reason: 'not a PNG or JPEG' })

  const noFrame = hostWith('/work/a.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))
  assert.deepEqual(await preparePicture('/work/a.jpg', noFrame), { ok: false, reason: 'the picture size cannot be read' })

  const wide = hostWith('/work/a.png', fakePng(30_000, 10))
  const refused = await preparePicture('/work/a.png', wide)
  assert.equal(refused.ok, false)
  assert.match(refused.ok ? '' : refused.reason, /side/)
  assert.deepEqual(wide.runs, [])
})

test('a failed conversion is refused and its folder still removed', async () => {
  for (const tool of [MACOS_TOOLS.base64, MACOS_TOOLS.sips]) {
    const host = hostWith('/work/b.jpg', fixture('tav-fixture-wide.jpg'))
    host.failing.add(tool)
    assert.deepEqual(await preparePicture('/work/b.jpg', host), { ok: false, reason: 'the conversion failed' })
    assert.deepEqual(host.tools().slice(-2), [MACOS_TOOLS.rm, MACOS_TOOLS.rmdir])
  }
})

test('a conversion with no private folder runs nothing else', async () => {
  for (const folder of ['', 'relative/tav', '/tmp/a\n/tmp/b']) {
    const host = hostWith('/work/b.jpg', fixture('tav-fixture-wide.jpg'))
    host.folder = folder
    assert.deepEqual(await preparePicture('/work/b.jpg', host), { ok: false, reason: 'no private folder for the conversion' })
    assert.deepEqual(host.tools(), [MACOS_TOOLS.mktemp])
  }
  const failing = hostWith('/work/b.jpg', fixture('tav-fixture-wide.jpg'))
  failing.failing.add(MACOS_TOOLS.mktemp)
  assert.deepEqual(await preparePicture('/work/b.jpg', failing), { ok: false, reason: 'no private folder for the conversion' })
})

test('a converted picture that is not a PNG or is too large is refused', async () => {
  const notPng = hostWith('/work/b.jpg', fixture('tav-fixture-wide.jpg'))
  notPng.converted = fixture('tav-fixture-wide.jpg')
  assert.deepEqual(await preparePicture('/work/b.jpg', notPng), { ok: false, reason: 'the conversion failed' })

  const tooLarge = hostWith('/work/b.jpg', fixture('tav-fixture-wide.jpg'))
  const limits = { ...LIMITS, maxInlinePngBytes: 1024 }
  assert.deepEqual(await preparePicture('/work/b.jpg', tooLarge, MACOS_TOOLS, limits), {
    ok: false,
    reason: 'the converted picture is still too large',
  })

  const nothing = hostWith('/work/b.jpg', fixture('tav-fixture-wide.jpg'))
  nothing.converted = undefined
  assert.deepEqual(await preparePicture('/work/b.jpg', nothing), { ok: false, reason: 'the conversion failed' })
})

test('a folder mktemp names despite failing is removed, or reported when it stays', async () => {
  const removed = hostWith('/work/b.jpg', fixture('tav-fixture-wide.jpg'))
  removed.mktempExit = 1
  assert.deepEqual(await preparePicture('/work/b.jpg', removed), { ok: false, reason: 'no private folder for the conversion' })
  assert.deepEqual(removed.tools(), [MACOS_TOOLS.mktemp, MACOS_TOOLS.rmdir])

  const stays = hostWith('/work/b.jpg', fixture('tav-fixture-wide.jpg'))
  stays.mktempExit = 1
  stays.failing.add(MACOS_TOOLS.rmdir)
  assert.deepEqual(await preparePicture('/work/b.jpg', stays), {
    ok: false,
    reason: 'no private folder for the conversion',
    leftBehind: stays.folder,
  })
})

test('bytes that cannot be decoded, and unforeseen throws, are refusals', async () => {
  const undecodable = hostWith('/work/a.png', fixture('tav-fixture-wide.png'))
  undecodable.decodeThrows = true
  assert.deepEqual(await preparePicture('/work/a.png', undecodable), { ok: false, reason: 'the file cannot be read' })

  // A run that throws before it hands back a promise, which no .catch on it sees.
  const throwing = hostWith('/work/b.jpg', fixture('tav-fixture-wide.jpg'))
  throwing.run = () => {
    throw new TypeError('thrown at once')
  }
  assert.deepEqual(await preparePicture('/work/b.jpg', throwing), { ok: false, reason: 'the picture cannot be prepared' })

  // A run that rejects is a failed step, not a throw.
  const rejecting = hostWith('/work/b.jpg', fixture('tav-fixture-wide.jpg'))
  rejecting.run = async () => {
    throw new Error('rejected')
  }
  assert.deepEqual(await preparePicture('/work/b.jpg', rejecting), { ok: false, reason: 'no private folder for the conversion' })
})

test('a folder the conversion cannot remove is reported', async () => {
  const host = hostWith('/work/b.jpg', fixture('tav-fixture-wide.jpg'))
  host.failing.add(MACOS_TOOLS.rmdir)
  const picture = await preparePicture('/work/b.jpg', host)
  assert.equal(picture.ok, true)
  assert.equal(picture.leftBehind, host.folder)
})

/** The host's own files and commands, for the macOS run below. */
const realHost: PrepareIO = {
  async stat(path) {
    const info = statSync(path)
    return { kind: info.isFile() ? 'file' : 'other', size: info.size, mtimeMs: info.mtimeMs, realPath: realpathSync(path) }
  },
  async read(path, offset, length) {
    const handle = openSync(path, 'r')
    try {
      const buffer = Buffer.alloc(length)
      const count = readSync(handle, buffer, 0, length, offset)
      return buffer.subarray(0, count).toString('base64')
    } finally {
      closeSync(handle)
    }
  },
  async run(argv, options) {
    const [command = '', ...args] = argv
    const done = spawnSync(command, args, { input: options.stdin, timeout: options.timeoutMs, encoding: 'utf8' })
    return { exitCode: done.status ?? -1, stdout: done.stdout ?? '' }
  },
  decode: fromBase64,
}

test('the macOS tools convert the JPEG fixture and leave nothing behind', { skip: process.platform !== 'darwin' }, async () => {
  const path = new URL('../../poc/fixtures/tav-fixture-wide.jpg', import.meta.url).pathname
  const picture = await preparePicture(path, realHost)
  assert.equal(picture.ok, true, picture.ok ? '' : picture.reason)
  assert.equal(picture.ok && picture.isConverted, true)
  assert.deepEqual(picture.ok && picture.size, { width: 640, height: 360 })
  assert.equal(picture.leftBehind, undefined)
})
