import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { jpegDimensions, pngDimensions, sizeRefusal, sniffFormat } from '../../src/artifact/format.ts'

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../poc/fixtures/${name}`, import.meta.url)))
const bytes = (...values: number[]) => new Uint8Array(values)

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const ihdr = (width: number, height: number, length = 13) =>
  bytes(
    ...PNG_SIGNATURE,
    0, 0, 0, length,
    0x49, 0x48, 0x44, 0x52,
    (width >>> 24) & 0xff, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff,
    (height >>> 24) & 0xff, (height >>> 16) & 0xff, (height >>> 8) & 0xff, height & 0xff,
  )

test('sniffFormat tells PNG and JPEG by their leading bytes', () => {
  assert.equal(sniffFormat(fixture('tav-fixture-wide.png')), 'png')
  assert.equal(sniffFormat(fixture('tav-fixture-wide.jpg')), 'jpeg')
  assert.equal(sniffFormat(bytes(0x47, 0x49, 0x46, 0x38)), undefined) // GIF
  assert.equal(sniffFormat(bytes(0x89, 0x50)), undefined)
  assert.equal(sniffFormat(bytes()), undefined)
})

test('pngDimensions reads the IHDR chunk', () => {
  assert.deepEqual(pngDimensions(fixture('tav-fixture-wide.png')), { width: 640, height: 360 })
  assert.deepEqual(pngDimensions(fixture('tav-fixture-tall.png')), { width: 300, height: 600 })
  assert.deepEqual(pngDimensions(ihdr(4_000_000_000, 1)), { width: 4_000_000_000, height: 1 })
})

test('pngDimensions refuses what is not a well-formed head', () => {
  assert.equal(pngDimensions(bytes(...PNG_SIGNATURE)), undefined)
  assert.equal(pngDimensions(ihdr(10, 10, 12)), undefined)
  assert.equal(pngDimensions(ihdr(0, 10)), undefined)
  assert.equal(pngDimensions(ihdr(10, 0)), undefined)
  const notIhdr = ihdr(10, 10)
  notIhdr[12] = 0x69
  assert.equal(pngDimensions(notIhdr), undefined)
  assert.equal(pngDimensions(fixture('tav-fixture-wide.jpg')), undefined)
})

test('jpegDimensions finds the start-of-frame segment', () => {
  assert.deepEqual(jpegDimensions(fixture('tav-fixture-wide.jpg')), { width: 640, height: 360 })
  // Fill bytes before a marker, then a baseline frame of 2 x 3.
  const filled = bytes(0xff, 0xd8, 0xff, 0xff, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x03, 0x00, 0x02, 0x03)
  assert.deepEqual(jpegDimensions(filled), { width: 2, height: 3 })
  // A progressive frame (SOF2) after an APP0 segment.
  const progressive = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc2, 0x00, 0x11, 0x08, 0x00, 0x05, 0x00, 0x07, 0x03)
  assert.deepEqual(jpegDimensions(progressive), { width: 7, height: 5 })
})

test('jpegDimensions leaves the size unknown when it is not there', () => {
  const head = fixture('tav-fixture-wide.jpg')
  assert.equal(jpegDimensions(head.subarray(0, 20)), undefined) // cut before the frame
  assert.equal(jpegDimensions(bytes(0xff, 0xd8, 0xff, 0xda, 0x00, 0x02)), undefined) // image data first
  assert.equal(jpegDimensions(bytes(0xff, 0xd8, 0xff, 0xd9)), undefined) // end of image
  assert.equal(jpegDimensions(bytes(0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x00, 0x00, 0x02, 0x03)), undefined) // height 0
  assert.equal(jpegDimensions(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01)), undefined) // length below 2
  assert.equal(jpegDimensions(bytes(0xff, 0xd8, 0x00, 0x00)), undefined) // not a marker
  assert.equal(jpegDimensions(fixture('tav-fixture-wide.png')), undefined)
})

test('sizeRefusal names the bound a size passes', () => {
  assert.equal(sizeRefusal({ width: 3000, height: 2000 }), undefined)
  assert.match(sizeRefusal({ width: 20_001, height: 1 }) ?? '', /side/)
  assert.match(sizeRefusal({ width: 10_000, height: 10_000 }) ?? '', /pixels/)
  assert.equal(sizeRefusal({ width: 20_000, height: 2_000 }), undefined)
})
