// How many terminal cells a picture takes: as wide as the room allows, never larger
// than the picture itself, and no taller than the row limit, keeping its aspect ratio.

import { CELL_ASPECT, LIMITS } from './limits.ts'
import type { Dimensions } from './format.ts'

export type FitOptions = {
  /** Cell width divided by cell height. */
  readonly cellAspect: number
  readonly maxColumns: number
  readonly maxRows: number
  /** Columns left of the picture. */
  readonly indent: number
  /** Pixels one column stands for. */
  readonly cellWidthPx: number
}

export type Cells = { readonly columns: number; readonly rows: number }

export const DEFAULT_FIT: FitOptions = {
  cellAspect: CELL_ASPECT.default,
  maxColumns: LIMITS.maxColumns,
  maxRows: LIMITS.maxRows,
  indent: LIMITS.indent,
  cellWidthPx: LIMITS.cellWidthPx,
}

export function fitToCells(size: Dimensions, viewportColumns: number, options: FitOptions = DEFAULT_FIT): Cells {
  const room = Math.max(1, Math.floor(viewportColumns) - options.indent)
  const natural = Math.max(1, Math.ceil(size.width / options.cellWidthPx))
  let columns = Math.max(1, Math.min(options.maxColumns, room, natural))
  // Rows per column: the picture's height over its width, in cells of this aspect.
  const ratio = (size.height / size.width) * options.cellAspect
  let rows = Math.max(1, Math.round(columns * ratio))
  if (rows > options.maxRows) {
    rows = options.maxRows
    columns = Math.max(1, Math.min(columns, Math.round(rows / ratio)))
  }
  return { columns, rows }
}

/** The cell aspect from the plugin's settings: a number in range, else the nearest bound, else the default. */
export function parseCellAspect(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return CELL_ASPECT.default
  return Math.min(CELL_ASPECT.max, Math.max(CELL_ASPECT.min, value))
}
