import { describe, expect, test } from 'bun:test'
import { nextSort, sortKey, sortRows } from '../src/sort-rows.js'

const values = (rows, column = 'value') => rows.map((row) => row[column])

describe('nextSort', () => {
  test('cycles ascending, descending, then file order', () => {
    const ascending = nextSort(null, 2)
    expect(ascending).toEqual({ column: 2, direction: 1 })
    const descending = nextSort(ascending, 2)
    expect(descending).toEqual({ column: 2, direction: -1 })
    expect(nextSort(descending, 2)).toBeNull()
  })

  test('a different column starts ascending', () => {
    expect(nextSort({ column: 2, direction: -1 }, 4)).toEqual({ column: 4, direction: 1 })
  })
})

describe('sortKey', () => {
  test('dates become timestamps and missing values become null', () => {
    expect(sortKey(new Date('2026-01-15T10:30:00Z'))).toBe(Date.parse('2026-01-15T10:30:00Z'))
    expect(sortKey(null)).toBeNull()
    expect(sortKey(undefined)).toBeNull()
  })
})

describe('sortRows', () => {
  test('sorts numbers in both directions', () => {
    const rows = [{ value: 3 }, { value: 1 }, { value: 2 }]
    sortRows(rows, 'value')
    expect(values(rows)).toEqual([1, 2, 3])
    sortRows(rows, 'value', -1)
    expect(values(rows)).toEqual([3, 2, 1])
  })

  test('sorts bigints exactly', () => {
    const rows = [{ value: 10n }, { value: 2n }, { value: 9007199254740993n }]
    sortRows(rows, 'value')
    expect(values(rows)).toEqual([2n, 10n, 9007199254740993n])
  })

  test('sorts dates by instant', () => {
    const rows = [
      { value: new Date('2026-02-01T00:00:00Z') },
      { value: new Date('2026-01-01T00:00:00Z') }
    ]
    sortRows(rows, 'value')
    expect(values(rows).map((date) => date.toISOString())).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z'
    ])
  })

  test('sorts strings naturally, so row-2 comes before row-10', () => {
    const rows = [{ value: 'row-10' }, { value: 'row-2' }, { value: 'row-1' }]
    sortRows(rows, 'value')
    expect(values(rows)).toEqual(['row-1', 'row-2', 'row-10'])
  })

  test('sorts booleans false first', () => {
    const rows = [{ value: true }, { value: false }, { value: true }]
    sortRows(rows, 'value')
    expect(values(rows)).toEqual([false, true, true])
  })

  test('keeps nulls last in both directions', () => {
    const ascending = [{ value: 2 }, { value: null }, { value: 1 }]
    sortRows(ascending, 'value')
    expect(values(ascending)).toEqual([1, 2, null])
    const descending = [{ value: 2 }, { value: null }, { value: 1 }]
    sortRows(descending, 'value', -1)
    expect(values(descending)).toEqual([2, 1, null])
  })

  test('equal values keep their file order', () => {
    const rows = [
      { id: 'a', value: 1 },
      { id: 'b', value: 1 },
      { id: 'c', value: 0 }
    ]
    sortRows(rows, 'value')
    expect(rows.map((row) => row.id)).toEqual(['c', 'a', 'b'])
  })

  test('nested values fall back to their displayed text', () => {
    const rows = [{ value: { b: 2 } }, { value: { a: 1 } }]
    sortRows(rows, 'value')
    expect(rows.map((row) => row.value)).toEqual([{ a: 1 }, { b: 2 }])
  })
})
