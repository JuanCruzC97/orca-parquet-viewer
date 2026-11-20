// Width rules for grid columns: the width a file opens with, the bounds a drag or auto-fit
// can reach, and the auto-fit calculation itself. Kept apart from the grid so the math is
// testable without a DOM.

export const MIN_COLUMN_WIDTH = 72
export const MAX_COLUMN_WIDTH = 480
// Left and right cell padding (8px each), plus a little room so text never sits under the
// resize handle at the column's right edge.
const COLUMN_PADDING = 22

/** Keeps a column inside the widths a person can drag it to. */
export function clampColumnWidth(width) {
  return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width)))
}

/** The width a column gets when the file opens: room for both header lines, at least MIN. */
export function headerColumnWidth(measureText, column) {
  return clampColumnWidth(Math.max(measureText(column.name), measureText(column.label)) + COLUMN_PADDING)
}

/** Auto-fit: the widest of the two header lines and the sampled cell texts. */
export function fittedColumnWidth(measureText, column, texts) {
  let widest = Math.max(measureText(column.name), measureText(column.label))
  for (const text of texts) widest = Math.max(widest, measureText(text))
  return clampColumnWidth(widest + COLUMN_PADDING)
}
