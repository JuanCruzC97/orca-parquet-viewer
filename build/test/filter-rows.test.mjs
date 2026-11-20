import { describe, expect, test } from 'bun:test'
import { compileFilter } from '../src/filter-rows.js'

const text = { name: 'name', label: 'string', kind: null }
const integer = { name: 'qty', label: 'int64', kind: null }
const decimal = { name: 'amount', label: 'decimal(18,3)', kind: null }
const timestamp = { name: 'when', label: 'timestamp[us]', kind: 'timestamp' }
const boolean = { name: 'active', label: 'boolean', kind: null }
const testFilter = (filter, value, column) => compileFilter(filter, column)(value)

describe('text filters', () => {
  test('an empty filter matches nothing because it is not a filter', () => {
    expect(compileFilter('', text)).toBeNull()
    expect(compileFilter('   ', text)).toBeNull()
  })

  test('contains text, case-insensitively', () => {
    expect(testFilter('ali', 'Alice', text)).toBe(true)
    expect(testFilter('ALI', 'Alice', text)).toBe(true)
    expect(testFilter('bob', 'Alice', text)).toBe(false)
  })

  test('works on the displayed text of dates and numbers', () => {
    expect(testFilter('2025-01', new Date('2025-01-02T00:00:00Z'), timestamp)).toBe(true)
    expect(testFilter('100', 1000n, integer)).toBe(true)
    expect(testFilter('null', null, text)).toBe(true)
  })

  test('comparison-looking text on a text column is still contains', () => {
    expect(testFilter('>100', 'a>100b', text)).toBe(true)
    expect(testFilter('>100', 'a100b', text)).toBe(false)
  })
})

describe('number filters', () => {
  test('compares numbers in either direction', () => {
    expect(testFilter('>100', 101n, integer)).toBe(true)
    expect(testFilter('>100', 100n, integer)).toBe(false)
    expect(testFilter('<= 5', 5, integer)).toBe(true)
    expect(testFilter('< 5', 5, integer)).toBe(false)
    expect(testFilter('= 5', 5, integer)).toBe(true)
    expect(testFilter('!= 5', 6, integer)).toBe(true)
  })

  test('compares big integers without losing precision', () => {
    expect(testFilter('=9007199254740993', 9007199254740993n, integer)).toBe(true)
    expect(testFilter('=9007199254740993', 9007199254740992n, integer)).toBe(false)
  })

  test('supports inclusive ranges', () => {
    expect(testFilter('100..200', 100n, integer)).toBe(true)
    expect(testFilter('100..200', 200n, integer)).toBe(true)
    expect(testFilter('100..200', 201n, integer)).toBe(false)
    expect(testFilter('100..200', 99n, integer)).toBe(false)
  })

  test('decimal columns compare as fractions', () => {
    expect(testFilter('>1.5', 1.6, decimal)).toBe(true)
    expect(testFilter('>1.5', 1.5, decimal)).toBe(false)
  })

  test('nulls never match a comparison', () => {
    expect(testFilter('>1', null, integer)).toBe(false)
    expect(testFilter('!=1', null, integer)).toBe(false)
  })
})

describe('date filters', () => {
  const start = new Date('2025-01-01T00:00:00Z')
  const middle = new Date('2025-06-15T12:00:00Z')
  const nextYear = new Date('2026-01-01T00:00:00Z')

  test('compares timestamps by instant', () => {
    expect(testFilter('>=2025-01-01', start, timestamp)).toBe(true)
    expect(testFilter('>2025-01-01', start, timestamp)).toBe(false)
    expect(testFilter('>2025-01-01', middle, timestamp)).toBe(true)
  })

  test('supports inclusive date ranges', () => {
    expect(testFilter('2025-01-01..2025-12-31', middle, timestamp)).toBe(true)
    expect(testFilter('2025-01-01..2025-12-31', new Date('2025-12-31T23:00:00Z'), timestamp)).toBe(true)
    expect(testFilter('2025-01-01..2025-12-31', nextYear, timestamp)).toBe(false)
  })

  test('a date-only equality covers the whole day', () => {
    expect(testFilter('=2025-01-01', middle, timestamp)).toBe(false)
    expect(testFilter('=2025-01-01', new Date('2025-01-01T12:00:00Z'), timestamp)).toBe(true)
    expect(testFilter('=2025-01-01', new Date('2025-01-02T00:00:00Z'), timestamp)).toBe(false)
  })

  test('a date-time without an offset is read as UTC', () => {
    expect(testFilter('>2025-01-01T12:00:00', new Date('2025-01-01T12:00:01Z'), timestamp)).toBe(true)
    expect(testFilter('>2025-01-01T12:00:00', new Date('2025-01-01T11:59:59Z'), timestamp)).toBe(false)
  })

  test('an invalid date comparison falls back to contains', () => {
    expect(testFilter('>not-a-date', start, timestamp)).toBe(false)
  })
})

describe('boolean filters', () => {
  test('matches true and false through contains', () => {
    expect(testFilter('true', true, boolean)).toBe(true)
    expect(testFilter('false', false, boolean)).toBe(true)
    expect(testFilter('true', false, boolean)).toBe(false)
  })
})
