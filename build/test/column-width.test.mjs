import { describe, expect, test } from 'bun:test'
import {
  clampColumnWidth,
  fittedColumnWidth,
  headerColumnWidth,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH
} from '../src/column-width.js'

// A stand-in for canvas measureText: every character is 7px wide.
const measure = (text) => String(text).length * 7
const column = { name: 'timestamp', label: 'timestamp[us]' }

describe('clampColumnWidth', () => {
  test('keeps a width inside the draggable bounds', () => {
    expect(clampColumnWidth(10)).toBe(MIN_COLUMN_WIDTH)
    expect(clampColumnWidth(200)).toBe(200)
    expect(clampColumnWidth(10_000)).toBe(MAX_COLUMN_WIDTH)
  })

  test('rounds fractional drags to whole pixels', () => {
    expect(clampColumnWidth(120.4)).toBe(120)
    expect(clampColumnWidth(120.6)).toBe(121)
  })
})

describe('headerColumnWidth', () => {
  test('leaves room for the wider of the name and the type', () => {
    expect(headerColumnWidth(measure, column)).toBe(measure('timestamp[us]') + 22)
  })

  test('never opens narrower than the minimum', () => {
    expect(headerColumnWidth(measure, { name: 'a', label: 'b' })).toBe(MIN_COLUMN_WIDTH)
  })
})

describe('fittedColumnWidth', () => {
  test('uses the widest sampled value when it beats the header', () => {
    const texts = ['2026-01-15T10:30:00Z', 'short']
    expect(fittedColumnWidth(measure, column, texts)).toBe(measure('2026-01-15T10:30:00Z') + 22)
  })

  test('falls back to the header when no rows are loaded', () => {
    expect(fittedColumnWidth(measure, column, [])).toBe(headerColumnWidth(measure, column))
  })

  test('caps very long values at the maximum width', () => {
    expect(fittedColumnWidth(measure, column, ['x'.repeat(500)])).toBe(MAX_COLUMN_WIDTH)
  })
})
