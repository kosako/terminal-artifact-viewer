// Which attachments of a tool result are pictures the viewer may try to draw.
// The attachment fields come from Claude Code's SendUserFile result; nothing in
// them is trusted beyond its type, and the file itself is checked again on read.

import { LIMITS } from './limits.ts'

export type Attachment = {
  readonly path?: unknown
  readonly isImage?: unknown
  readonly media_type?: unknown
  readonly pathValidated?: unknown
  readonly size?: unknown
}

export type ImageMediaType = 'image/png' | 'image/jpeg'

export type Candidate = {
  /** Position in the result's attachment list, which the drawing keeps. */
  readonly index: number
  readonly path: string
  readonly mediaType: ImageMediaType
}

/** The attachment list of a tool result's output, in its order, or undefined when there is none. */
export function attachmentsOf(output: unknown): readonly Attachment[] | undefined {
  if (typeof output !== 'object' || output === null) return undefined
  const list = (output as { attachments?: unknown }).attachments
  if (!Array.isArray(list)) return undefined
  return list.map(item => (typeof item === 'object' && item !== null ? (item as Attachment) : {}))
}

/** The attachments to try, in order, at most `maxImages` of them. */
export function imageCandidates(list: readonly Attachment[], maxImages: number = LIMITS.maxImagesPerResult): Candidate[] {
  const found: Candidate[] = []
  for (const [index, item] of list.entries()) {
    if (found.length >= maxImages) break
    const mediaType = item.media_type
    if (item.isImage !== true || item.pathValidated !== true) continue
    if (mediaType !== 'image/png' && mediaType !== 'image/jpeg') continue
    if (!isAbsolutePath(item.path)) continue
    found.push({ index, path: item.path, mediaType })
  }
  return found
}

function isAbsolutePath(path: unknown): path is string {
  return typeof path === 'string' && path.startsWith('/') && !path.includes('\0')
}
