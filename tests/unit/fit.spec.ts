import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_FIT, fitToCells, parseCellAspect } from '../../src/artifact/fit.ts'

test('a wide picture takes its natural width when the room allows', () => {
  // 640 px at 7 px a column fills 91 whole columns; 91 x (360 / 640) x 0.41 rounds to 21 rows.
  assert.deepEqual(fitToCells({ width: 640, height: 360 }, 236), { columns: 91, rows: 21 })
})

test('a picture is never drawn wider than its own pixels', () => {
  // 8 px fill one whole column of 7 px; two columns would be 14 px.
  assert.equal(fitToCells({ width: 8, height: 8 }, 236).columns, 1)
  assert.equal(fitToCells({ width: 13, height: 8 }, 236).columns, 1)
  assert.equal(fitToCells({ width: 14, height: 8 }, 236).columns, 2)
})

test('a wide picture shrinks to the room left of the viewport', () => {
  // 60 columns less the indent of 4.
  assert.deepEqual(fitToCells({ width: 640, height: 360 }, 60), { columns: 56, rows: 13 })
})

test('a wide picture is never wider than maxColumns', () => {
  // 3000 x 1000 stays under maxRows at 100 columns: round(100 x (1000 / 3000) x 0.41) = 14.
  const cells = fitToCells({ width: 3000, height: 1000 }, 300)
  assert.equal(cells.columns, DEFAULT_FIT.maxColumns)
  assert.equal(cells.rows, 14)
})

test('a tall picture is held to maxRows and narrowed to keep its aspect ratio', () => {
  // 43 columns would need 35 rows; 24 rows take round(24 / (2 x 0.41)) = 29 columns.
  assert.deepEqual(fitToCells({ width: 300, height: 600 }, 236), { columns: 29, rows: 24 })
})

test('the drawn box keeps the picture aspect ratio within a rounding of one cell', () => {
  for (const [width, height] of [[640, 360], [300, 600], [1600, 900], [1000, 1000], [2000, 500]] as const) {
    const { columns, rows } = fitToCells({ width, height }, 236)
    const drawn = (columns / rows) * DEFAULT_FIT.cellAspect
    const expected = width / height
    assert.ok(Math.abs(drawn - expected) / expected < 1 / Math.min(columns, rows) + 0.02, `${width}x${height}`)
  }
})

test('tiny and narrow cases still give at least one cell', () => {
  assert.deepEqual(fitToCells({ width: 1, height: 1 }, 236), { columns: 1, rows: 1 })
  assert.deepEqual(fitToCells({ width: 640, height: 360 }, 3), { columns: 1, rows: 1 })
  assert.deepEqual(fitToCells({ width: 20_000, height: 1 }, 236), { columns: 100, rows: 1 })
  assert.deepEqual(fitToCells({ width: 1, height: 20_000 }, 236), { columns: 1, rows: 24 })
})

test('input that is not a positive finite number still gives at least one cell', () => {
  const wide = { width: 640, height: 360 }
  for (const viewport of [Number.NaN, Number.POSITIVE_INFINITY, -5, 0]) {
    const cells = fitToCells(wide, viewport)
    assert.ok(cells.columns >= 1 && cells.rows >= 1, `viewport ${viewport}`)
    assert.ok(Number.isInteger(cells.columns) && Number.isInteger(cells.rows), `viewport ${viewport}`)
  }
  assert.deepEqual(fitToCells({ width: Number.NaN, height: 10 }, 236), { columns: 1, rows: 1 })
  assert.deepEqual(fitToCells({ width: 10, height: 0 }, 236), { columns: 1, rows: 1 })
  const odd = { ...DEFAULT_FIT, maxRows: 0, maxColumns: Number.NaN, cellWidthPx: 0, cellAspect: Number.NaN, indent: -3 }
  const cells = fitToCells(wide, 236, odd)
  assert.ok(cells.columns >= 1 && cells.rows === 1)
})

test('the cell aspect from settings is a finite number held to its range', () => {
  assert.equal(parseCellAspect(undefined), 0.41)
  assert.equal(parseCellAspect('0.5'), 0.41)
  assert.equal(parseCellAspect(Number.NaN), 0.41)
  assert.equal(parseCellAspect(Number.POSITIVE_INFINITY), 0.41)
  assert.equal(parseCellAspect(0.5), 0.5)
  assert.equal(parseCellAspect(0.01), 0.2)
  assert.equal(parseCellAspect(5), 1)
})
