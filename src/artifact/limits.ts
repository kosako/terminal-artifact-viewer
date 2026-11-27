// Bounds on what the viewer reads and draws. docs/v0.1-design.md explains each value.

export const LIMITS = {
  /** The largest file read at all. */
  maxSourceBytes: 20 * 1024 * 1024,
  /** Width times height. */
  maxPixels: 40_000_000,
  /** Either side, in pixels. */
  maxSide: 20_000,
  /** Attachments of one tool result that get a picture; later ones keep only their row. */
  maxImagesPerResult: 8,
  /** The largest PNG handed to the Image element as bytes (decoded size). */
  maxInlinePngBytes: 2 * 1024 * 1024,
  /** A picture past maxInlinePngBytes is converted down to this longer side, in pixels. */
  shrinkLongerSide: 1600,
  /** The widest picture, in terminal columns. */
  maxColumns: 100,
  /** The tallest picture, in terminal rows. */
  maxRows: 24,
  /** Columns left of the picture, to line it up under the row's text. */
  indent: 4,
  /** Pixels one column stands for, so a small picture is not drawn larger than it is. */
  cellWidthPx: 7,
  /** Pictures kept in memory for the session. */
  cacheEntries: 32,
  /** Bytes kept in memory for the session, all pictures together. */
  cacheBytes: 64 * 1024 * 1024,
} as const

/** Cell width divided by cell height. The default was measured on the first device (7.0 x 16.9 px). */
export const CELL_ASPECT = { default: 0.41, min: 0.2, max: 1.0 } as const

export type Limits = typeof LIMITS
