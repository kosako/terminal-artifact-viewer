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

/**
 * At least one cell each way, whatever the input: a size or option that is not a
 * positive finite number falls back to the default (or to one cell for the viewport).
 * A picture narrower than one column still takes one.
 */
export function fitToCells(size: Dimensions, viewportColumns: number, options: FitOptions = DEFAULT_FIT): Cells {
  if (!isPositive(size.width) || !isPositive(size.height)) return { columns: 1, rows: 1 }
  const maxColumns = wholeAtLeastOne(options.maxColumns, DEFAULT_FIT.maxColumns)
  const maxRows = wholeAtLeastOne(options.maxRows, DEFAULT_FIT.maxRows)
  const indent = Number.isFinite(options.indent) ? Math.max(0, Math.floor(options.indent)) : DEFAULT_FIT.indent
  const cellWidthPx = isPositive(options.cellWidthPx) ? options.cellWidthPx : DEFAULT_FIT.cellWidthPx
  const cellAspect = parseCellAspect(options.cellAspect)

  const viewport = Number.isFinite(viewportColumns) ? Math.floor(viewportColumns) : 0
  const room = Math.max(1, viewport - indent)
  // Whole columns the picture fills at its own size; never more, so it is not enlarged.
  const natural = Math.max(1, Math.floor(size.width / cellWidthPx))
  let columns = Math.min(maxColumns, room, natural)
  // Rows per column: the picture's height over its width, in cells of this aspect.
  const ratio = (size.height / size.width) * cellAspect
  let rows = Math.max(1, Math.round(columns * ratio))
  if (rows > maxRows) {
    rows = maxRows
    columns = Math.max(1, Math.min(columns, Math.round(rows / ratio)))
  }
  return { columns, rows }
}

function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function wholeAtLeastOne(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback
}

/** The cell aspect from the plugin's settings: a number in range, else the nearest bound, else the default. */
export function parseCellAspect(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return CELL_ASPECT.default
  return Math.min(CELL_ASPECT.max, Math.max(CELL_ASPECT.min, value))
}
