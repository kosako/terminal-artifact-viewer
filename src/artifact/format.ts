// Which image a file holds and how large it is, read from its leading bytes only.

import { LIMITS } from './limits.ts'

export type ImageFormat = 'png' | 'jpeg'

export type Dimensions = { readonly width: number; readonly height: number }

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
const IHDR = [0x49, 0x48, 0x44, 0x52] as const

/** Bytes of a PNG that hold its size: the signature and the IHDR chunk up to the height. */
export const PNG_HEAD_BYTES = 24

/** The format the leading bytes announce, or undefined for anything else. */
export function sniffFormat(head: Uint8Array): ImageFormat | undefined {
  if (startsWith(head, PNG_SIGNATURE, 0)) return 'png'
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg'
  return undefined
}

/** Width and height from a PNG's first chunk, which must be an IHDR of length 13. */
export function pngDimensions(head: Uint8Array): Dimensions | undefined {
  if (head.length < PNG_HEAD_BYTES || sniffFormat(head) !== 'png') return undefined
  if (readUint32(head, 8) !== 13 || !startsWith(head, IHDR, 12)) return undefined
  const width = readUint32(head, 16)
  const height = readUint32(head, 20)
  return width > 0 && height > 0 ? { width, height } : undefined
}

/**
 * Width and height from a JPEG's first start-of-frame segment within `bytes`.
 * Undefined when the segment is not in `bytes`, the stream is malformed, or the
 * height is 0 (left to a later DNL segment): the size is then unknown.
 */
export function jpegDimensions(bytes: Uint8Array): Dimensions | undefined {
  if (sniffFormat(bytes) !== 'jpeg') return undefined
  let i = 2
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) return undefined
    const marker = bytes[i + 1] ?? 0
    if (marker === 0xff) {
      // A fill byte: markers may be preceded by any number of them.
      i += 1
      continue
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      // A marker without a length.
      i += 2
      continue
    }
    if (marker === 0xd9 || marker === 0xda) return undefined // end of image, or image data before any frame
    if (i + 3 >= bytes.length) return undefined
    const length = readUint16(bytes, i + 2)
    if (length < 2) return undefined
    if (isStartOfFrame(marker)) {
      if (length < 7 || i + 8 >= bytes.length) return undefined
      const height = readUint16(bytes, i + 5)
      const width = readUint16(bytes, i + 7)
      return width > 0 && height > 0 ? { width, height } : undefined
    }
    i += 2 + length
  }
  return undefined
}

/** Why a picture of this size is not drawn, or undefined when it may be. */
export function sizeRefusal(size: Dimensions, limits: Pick<typeof LIMITS, 'maxSide' | 'maxPixels'> = LIMITS): string | undefined {
  if (size.width > limits.maxSide || size.height > limits.maxSide) return `a side is over ${limits.maxSide} px`
  if (size.width * size.height > limits.maxPixels) return `more than ${limits.maxPixels} pixels`
  return undefined
}

function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
}

function startsWith(bytes: Uint8Array, expected: readonly number[], at: number): boolean {
  if (bytes.length < at + expected.length) return false
  return expected.every((value, offset) => bytes[at + offset] === value)
}

function readUint16(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0)
}

function readUint32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) * 0x1000000) + (((bytes[at + 1] ?? 0) << 16) | ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0))
}
