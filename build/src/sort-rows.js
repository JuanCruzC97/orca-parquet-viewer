// Sorting the fully loaded rows in memory. Values arrive from hyparquet as null/undefined,
// boolean, number, bigint, string, Date, Array/object or Uint8Array. Nulls always go last,
// whatever the direction; strings compare with Intl.Collator (numeric-aware), so row-2 comes
// before row-10.

import { displayValue } from './cell-display.js'

const collator = new Intl.Collator(undefined, { numeric: true })

/** A comparable key for one cell value. Nested values fall back to their displayed text. */
export function sortKey(value) {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'bigint' || typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  return displayValue(value, {}).text
}

/** Orders two non-null keys. */
export function compareKeys(a, b) {
  if (typeof a === 'bigint' || typeof b === 'bigint') {
    if (typeof a === 'bigint' && typeof b === 'bigint') return a < b ? -1 : a > b ? 1 : 0
    const left = typeof a === 'bigint' ? Number(a) : a
    const right = typeof b === 'bigint' ? Number(b) : b
    return left < right ? -1 : left > right ? 1 : 0
  }
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? 1 : -1
  if (typeof a === 'string' && typeof b === 'string') return collator.compare(a, b)
  return collator.compare(String(a), String(b))
}

/** Next header-click state: ascending, then descending, then back to the file order. */
export function nextSort(current, column) {
  if (!current || current.column !== column) return { column, direction: 1 }
  if (current.direction === 1) return { column, direction: -1 }
  return null
}

/** Sorts rows in place by one column, keeping nulls last and equal values in file order. */
export function sortRows(rows, columnName, direction = 1) {
  const sign = direction < 0 ? -1 : 1
  const keys = new Array(rows.length)
  for (let index = 0; index < rows.length; index++) keys[index] = sortKey(rows[index]?.[columnName])
  const order = Array.from({ length: rows.length }, (_, index) => index)
  order.sort((a, b) => {
    const left = keys[a]
    const right = keys[b]
    if (left === null || right === null) {
      if (left === right) return a - b
      return left === null ? 1 : -1
    }
    const compared = compareKeys(left, right)
    return compared === 0 ? a - b : compared * sign
  })
  const sorted = order.map((index) => rows[index])
  for (let index = 0; index < sorted.length; index++) rows[index] = sorted[index]
  return rows
}
