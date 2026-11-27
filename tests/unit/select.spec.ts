import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attachmentsOf, imageCandidates } from '../../src/artifact/select.ts'

const png = (path: string) => ({ path, isImage: true, media_type: 'image/png', pathValidated: true, size: 10 })

test('attachmentsOf reads the list in order and keeps every position', () => {
  assert.equal(attachmentsOf(undefined), undefined)
  assert.equal(attachmentsOf('text'), undefined)
  assert.equal(attachmentsOf({}), undefined)
  assert.equal(attachmentsOf({ attachments: 'x' }), undefined)
  const list = attachmentsOf({ attachments: [png('/a.png'), null, 'x', png('/b.png')] })
  assert.equal(list?.length, 4)
  assert.deepEqual(list?.[1], {})
  assert.deepEqual(list?.[2], {})
})

test('imageCandidates keeps PNG and JPEG pictures with a validated absolute path', () => {
  const list = [
    png('/tmp/a.png'),
    { path: '/repo/README.md', isImage: false, media_type: 'text/markdown', pathValidated: true },
    { path: '/tmp/b.jpg', isImage: true, media_type: 'image/jpeg', pathValidated: true },
  ]
  assert.deepEqual(imageCandidates(list), [
    { index: 0, path: '/tmp/a.png', mediaType: 'image/png' },
    { index: 2, path: '/tmp/b.jpg', mediaType: 'image/jpeg' },
  ])
})

test('imageCandidates skips what it should not read', () => {
  const list = [
    { ...png('/tmp/a.png'), pathValidated: false },
    { ...png('/tmp/a.png'), pathValidated: 'true' },
    { ...png('/tmp/a.png'), isImage: 'yes' },
    { ...png('/tmp/a.gif'), media_type: 'image/gif' },
    png('relative/a.png'),
    png('/tmp/a\0.png'),
    { ...png('/tmp/a.png'), path: 42 },
    {},
  ]
  assert.deepEqual(imageCandidates(list), [])
})

test('imageCandidates stops after maxImages pictures', () => {
  const list = Array.from({ length: 10 }, (_, i) => png(`/tmp/${i}.png`))
  const found = imageCandidates(list, 8)
  assert.equal(found.length, 8)
  assert.equal(found.at(-1)?.index, 7)
  assert.deepEqual(imageCandidates(list, 0), [])
})
