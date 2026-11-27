import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// A 1 x 1 PNG, and a JPEG holding only a 16 x 9 frame header.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x09, 0x00, 0x10, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
]).toBase64()

const PLUGIN = 'terminal-artifact-viewer'
const ON_SCREEN = { first: 0, last: 3, of: 4 }

type Attachment = { path: string; size: number; isImage: boolean; media_type?: string; pathValidated?: boolean }
const image = (path: string, mediaType = 'image/png'): Attachment => ({
  path,
  size: 1,
  isImage: true,
  media_type: mediaType,
  pathValidated: true,
})
const file = (path: string): Attachment => ({ path, size: 1, isImage: false, media_type: 'text/markdown', pathValidated: true })

const ran = (stdout = '') => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

/** Files in memory by path, as base64; the conversion commands act on them. `touched` gets each path stat or read. */
function host(on: On, files: Record<string, string>, touched: string[] = []) {
  const runs: string[][] = []
  on('fs.stat', (_, e) => {
    touched.push(e.path)
    const base64 = files[e.path]
    if (base64 === undefined) return { deny: 'no such file' }
    return { value: { kind: 'file', size: Uint8Array.fromBase64(base64).length, mtimeMs: 1, isLink: false, realPath: e.path } }
  })
  on('fs.read', (_, e) => {
    touched.push(e.path)
    const base64 = files[e.path]
    if (base64 === undefined) return { deny: 'no such file' }
    const bytes = Uint8Array.fromBase64(base64)
    const offset = e.offset ?? 0
    return { value: { base64: bytes.subarray(offset, offset + (e.length ?? bytes.length)).toBase64() } }
  })
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    runs.push(argv)
    if (argv[0] === '/usr/bin/mktemp') return { value: ran('/fake/tav.1\n') }
    if (argv[0] === '/usr/bin/sips') files[argv.at(-1) ?? ''] = PNG
    return { value: ran() }
  })
  return runs
}

/** Stands for the engine's own drawing of the result row, recording each output it is handed. */
function engineRows(on: On) {
  const outputs: { attachments?: Attachment[]; caption?: string }[] = []
  on('ui.render', { component: 'ToolResult' }, ($, e) => {
    const output = e.props.output as { attachments?: Attachment[]; caption?: string }
    outputs.push(output)
    const { Text } = $.ui.resolve(e)
    return <Text>{`engine: ${(output.attachments ?? []).map(item => item.path).join(', ')}`}</Text>
  })
  return outputs
}

/** Runs one SendUserFile call through the plugin, the test answering for the engine; resolves its id. */
async function send($: Parameters<Parameters<typeof test>[1]>[0], on: On, attachments: Attachment[], caption?: string) {
  let id = ''
  on('tool.call', { tool: 'SendUserFile' }, (_, e) => {
    id = e.tool_use_id
    return { result: { attachments, ...(caption === undefined ? {} : { caption }) } }
  })
  await $.tool.call({ tool: 'SendUserFile', files: attachments.map(item => item.path), status: 'normal' })
  return id
}

function mountRow($: Parameters<Parameters<typeof test>[1]>[0], id: string, attachments: Attachment[], extra: Record<string, unknown> = {}) {
  return $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'ToolResult',
    requestId: id,
    viewport: { columns: 120, rows: 40, isFullscreen: true },
    props: { tool_use_id: id, tool: 'SendUserFile', output: { attachments, ...extra }, isErrored: false, onScreen: ON_SCREEN },
  })
}

test('a picture is prepared off the render, then drawn right under its own row', async ($, on) => {
  const clock = mock.clock(on)
  engineRows(on)
  host(on, { '/work/a.png': PNG })
  const attachments = [image('/work/a.png')]
  const id = await send($, on, attachments)

  const ui = await mountRow($, id, attachments)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'engine: /work/a.png' })).toBeDefined()

  await clock.advance(1)
  const picture = await ui.find({ type: 'Image' })
  expect(picture?.key).toBe('tav-0')
  expect(picture?.props).toMatchObject({ columns: 1, rows: 1, source: { png: PNG } })
  await ui.unmount()
})

test('rows are split at each picture, and the caption stays with the first piece', async ($, on) => {
  const clock = mock.clock(on)
  const outputs = engineRows(on)
  host(on, { '/work/a.png': PNG, '/work/b.png': PNG })
  const attachments = [file('/work/notes.md'), image('/work/a.png'), file('/work/README.md'), image('/work/b.png'), file('/work/z.md')]
  const id = await send($, on, attachments, 'before and after')

  const ui = await mountRow($, id, attachments, { caption: 'before and after' })
  await clock.advance(1)
  expect((await ui.findAll({ type: 'Image' })).map(found => found.key)).toEqual(['tav-1', 'tav-3'])
  const pieces = outputs.slice(-3)
  expect(pieces.map(output => output.attachments?.map(item => item.path))).toEqual([
    ['/work/notes.md', '/work/a.png'],
    ['/work/README.md', '/work/b.png'],
    ['/work/z.md'],
  ])
  expect(pieces.map(output => output.caption)).toEqual(['before and after', undefined, undefined])
  await ui.unmount()
})

test('a JPEG is converted from a private copy, never from its own path', async ($, on) => {
  const clock = mock.clock(on)
  engineRows(on)
  const runs = host(on, { '/work/b.jpg': JPEG })
  const attachments = [image('/work/b.jpg', 'image/jpeg')]
  const id = await send($, on, attachments)

  const ui = await mountRow($, id, attachments)
  await clock.advance(1)
  expect((await ui.find({ type: 'Image' }))?.props).toMatchObject({ source: { png: PNG } })
  expect(runs.map(argv => argv[0])).toEqual(['/usr/bin/mktemp', '/usr/bin/base64', '/usr/bin/sips', '/bin/rm', '/bin/rmdir'])
  expect(runs.flat()).not.toContain('/work/b.jpg')
  await ui.unmount()
})

test('a picture removed after it was sent leaves its row and a short reason', async ($, on) => {
  const clock = mock.clock(on)
  engineRows(on)
  const files: Record<string, string> = { '/work/gone.png': PNG }
  host(on, files)
  const attachments = [image('/work/gone.png')]
  const id = await send($, on, attachments)
  delete files['/work/gone.png']

  const ui = await mountRow($, id, attachments)
  await clock.advance(1)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /picture not shown: the file cannot be read/ }))?.text).toContain('not shown')
  expect(await ui.find({ type: 'Text', text: /engine: \/work\/gone.png/ })).toBeDefined()
  await ui.unmount()
})

test('rows the plugin did not register, and other surfaces, are the engine own', async ($, on) => {
  const clock = mock.clock(on)
  engineRows(on)
  const touched: string[] = []
  const runs = host(on, { '/work/a.png': PNG }, touched)
  const attachments = [image('/work/a.png')]
  // The hooks beneath the plugin go in before the test first calls $.
  let id = ''
  on('tool.call', { tool: 'SendUserFile' }, (_, e) => {
    id = e.tool_use_id
    return { result: { attachments } }
  })

  // A resumed session's row: no tool.call ran for it here.
  const replayed = await mountRow($, 'toolu_replayed', attachments)
  await clock.advance(1000)
  expect(await replayed.find({ type: 'Image' })).toBeUndefined()
  expect(await replayed.find({ type: 'Text', text: 'engine: /work/a.png' })).toBeDefined()
  expect(touched).toEqual([])
  await replayed.unmount()

  await $.tool.call({ tool: 'SendUserFile', files: ['/work/a.png'], status: 'normal' })
  // The send itself stats the file once, to remember which one was sent.
  expect(touched).toEqual(['/work/a.png'])
  const desktop = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'desktop',
    component: 'ToolResult',
    requestId: id,
    props: { tool_use_id: id, tool: 'SendUserFile', output: { attachments }, isErrored: false },
  })
  await clock.advance(1000)
  expect(await desktop.find({ type: 'Image' })).toBeUndefined()
  await desktop.unmount()
  expect(touched).toEqual(['/work/a.png'])
  expect(runs).toEqual([])
})

test('a terminal that refuses the picture twice gets the engine rows back, and a hint inside Herdr', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { HERDR_ENV: '1' })
  engineRows(on)
  host(on, { '/work/a.png': PNG })
  const blits: unknown[] = []
  on('ui.blit', (_, e) => {
    blits.push(e)
    return { value: { deny: 'the Image draws its alt here' } }
  })
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const attachments = [image('/work/a.png')]
  const id = await send($, on, attachments)

  const ui = await mountRow($, id, attachments)
  await clock.advance(1)
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  // The first refusal asks for a fresh draw, which asks again 1.5 s later.
  await clock.advance(500)
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  await clock.advance(500)
  expect(blits.length).toBe(1)
  await clock.advance(1000)
  expect(blits.length).toBe(2)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'engine: /work/a.png' })).toBeDefined()
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1')
  // The surface heads a toast with the plugin's name; the text does not repeat it.
  expect(toasts[0]).not.toContain('terminal-artifact-viewer')
  await ui.unmount()
})

test('a terminal that takes the picture keeps drawing it', async ($, on) => {
  const clock = mock.clock(on)
  engineRows(on)
  host(on, { '/work/a.png': PNG })
  let blits = 0
  on('ui.blit', () => {
    blits += 1
    return { value: {} }
  })
  const attachments = [image('/work/a.png')]
  const id = await send($, on, attachments)

  const ui = await mountRow($, id, attachments)
  await clock.advance(1)
  await clock.advance(5000)
  expect(blits).toBe(1)
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  await ui.unmount()
})

test('a file overwritten after it was sent is not drawn as the new picture', async ($, on) => {
  const clock = mock.clock(on)
  engineRows(on)
  const files: Record<string, string> = { '/work/shot.png': PNG }
  host(on, files)
  const attachments = [image('/work/shot.png')]
  const id = await send($, on, attachments)
  // The agent writes another picture to the same path before the row is drawn.
  files['/work/shot.png'] = JPEG

  const ui = await mountRow($, id, attachments)
  await clock.advance(1)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /the file changed since it was sent/ })).toBeDefined()
  await ui.unmount()
})

test('rows the cache let go do not prepare each other in turn', async ($, on) => {
  const clock = mock.clock(on)
  engineRows(on)
  const files: Record<string, string> = {}
  const touched: string[] = []
  host(on, files, touched)
  const ids: { id: string; attachments: Attachment[] }[] = []
  let next = ''
  on('tool.call', { tool: 'SendUserFile' }, (_, e) => {
    next = e.tool_use_id
    const path = (e as unknown as { files: string[] }).files[0] ?? ''
    return { result: { attachments: [image(path)] } }
  })
  // One more picture than the cache keeps, every row on screen at once.
  for (let i = 0; i < 33; i++) {
    files[`/work/${i}.png`] = PNG
    await $.tool.call({ tool: 'SendUserFile', files: [`/work/${i}.png`], status: 'normal' })
    ids.push({ id: next, attachments: [image(`/work/${i}.png`)] })
  }
  const rows = []
  for (const { id, attachments } of ids) rows.push(await mountRow($, id, attachments))
  for (let round = 0; round < 4; round++) {
    await clock.advance(10)
    for (const row of rows) await row.find({ type: 'Image' })
  }
  const settled = touched.length
  for (let round = 0; round < 4; round++) {
    await clock.advance(10)
    for (const row of rows) await row.find({ type: 'Image' })
  }
  expect(touched.length).toBe(settled)
  for (const row of rows) await row.unmount()
})

test('once a picture was drawn, a later refusal on another row does not turn pictures off', async ($, on) => {
  const clock = mock.clock(on)
  engineRows(on)
  host(on, { '/work/a.png': PNG, '/work/b.png': PNG })
  const answers = [{}, { deny: 'not mounted' }, { deny: 'not mounted' }]
  let blits = 0
  on('ui.blit', () => ({ value: answers[blits++] ?? { deny: 'not mounted' } }))
  let id = ''
  on('tool.call', { tool: 'SendUserFile' }, (_, e) => {
    id = e.tool_use_id
    const path = (e as unknown as { files: string[] }).files[0] ?? ''
    return { result: { attachments: [image(path)] } }
  })
  await $.tool.call({ tool: 'SendUserFile', files: ['/work/a.png'], status: 'normal' })
  const first = await mountRow($, id, [image('/work/a.png')])
  await clock.advance(1)
  await first.find({ type: 'Image' })
  await clock.advance(500)
  expect(blits).toBe(1)

  await $.tool.call({ tool: 'SendUserFile', files: ['/work/b.png'], status: 'normal' })
  const second = await mountRow($, id, [image('/work/b.png')])
  for (let round = 0; round < 4; round++) {
    await clock.advance(500)
    await second.find({ type: 'Image' })
  }
  expect(blits).toBe(1)
  expect(await first.find({ type: 'Image' })).toBeDefined()
  expect(await second.find({ type: 'Image' })).toBeDefined()
  await first.unmount()
  await second.unmount()
})

test('a picture missing when it was sent is not registered, and its row is the engine own', async ($, on) => {
  const clock = mock.clock(on)
  engineRows(on)
  const touched: string[] = []
  host(on, {}, touched)
  const attachments = [image('/work/never.png')]
  const id = await send($, on, attachments)
  const ui = await mountRow($, id, attachments)
  await clock.advance(1000)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /not shown/ })).toBeUndefined()
  expect(touched).toEqual(['/work/never.png'])
  await ui.unmount()
})

test('a blit call that fails is not counted as the terminal refusing', async ($, on) => {
  const clock = mock.clock(on)
  engineRows(on)
  host(on, { '/work/a.png': PNG })
  let blits = 0
  on('ui.blit', () => {
    blits += 1
    throw new Error('the call failed')
  })
  const attachments = [image('/work/a.png')]
  const id = await send($, on, attachments)

  const ui = await mountRow($, id, attachments)
  await clock.advance(1)
  for (let round = 0; round < 3; round++) {
    await ui.redraw()
    await clock.advance(2000)
  }
  expect(blits).toBeGreaterThan(1)
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  await ui.unmount()
})

test('a row whose picture the cache let go gets it back after leaving the screen and returning', async ($, on) => {
  const clock = mock.clock(on)
  engineRows(on)
  const files: Record<string, string> = {}
  host(on, files)
  const ids: { id: string; attachments: Attachment[] }[] = []
  let next = ''
  on('tool.call', { tool: 'SendUserFile' }, (_, e) => {
    next = e.tool_use_id
    const path = (e as unknown as { files: string[] }).files[0] ?? ''
    return { result: { attachments: [image(path)] } }
  })
  for (let i = 0; i < 33; i++) {
    files[`/work/${i}.png`] = PNG
    await $.tool.call({ tool: 'SendUserFile', files: [`/work/${i}.png`], status: 'normal' })
    ids.push({ id: next, attachments: [image(`/work/${i}.png`)] })
  }
  const rows = []
  for (const { id, attachments } of ids) {
    rows.push(await mountRow($, id, attachments))
    await clock.advance(1)
  }
  // The first row's picture went first: 32 pictures fit in the cache.
  const first = rows[0]
  const firstIds = ids[0]
  if (first === undefined || firstIds === undefined) throw new Error('no rows')
  await first.redraw()
  expect(await first.find({ type: 'Image' })).toBeUndefined()

  const props = { tool_use_id: firstIds.id, tool: 'SendUserFile', output: { attachments: firstIds.attachments }, isErrored: false }
  await first.redraw({ ...props, onScreen: null })
  await first.redraw({ ...props, onScreen: ON_SCREEN })
  await clock.advance(1)
  expect(await first.find({ type: 'Image' })).toBeDefined()
  for (const row of rows) await row.unmount()
})
