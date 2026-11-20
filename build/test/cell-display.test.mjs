import { describe, expect, test } from 'bun:test'
import { displayValue, escapeHtml, formatTimestamp, renderedText } from '../src/cell-display.js'
import { gunzip } from '../src/vendored/gzip.js'
import { gzipSync } from 'node:zlib'

describe('displayValue', () => {
  test('null and undefined show as null', () => {
    expect(displayValue(null, {})).toEqual({ text: 'null', kind: 'null' })
    expect(displayValue(undefined, {})).toEqual({ text: 'null', kind: 'null' })
  })

  test('bigint becomes text and aligns as a number', () => {
    expect(displayValue(94251302258849568n, {})).toEqual({ text: '94251302258849568', kind: 'number' })
  })

  test('numbers, including NaN and Infinity, render as-is', () => {
    expect(displayValue(10.1, {}).text).toBe('10.1')
    expect(displayValue(NaN, {}).text).toBe('NaN')
    expect(displayValue(Infinity, {}).text).toBe('Infinity')
    expect(displayValue(0, {}).kind).toBe('number')
  })

  test('booleans center', () => {
    expect(displayValue(true, {})).toEqual({ text: 'true', kind: 'boolean' })
    expect(displayValue(false, {})).toEqual({ text: 'false', kind: 'boolean' })
  })

  test('strings stay text', () => {
    expect(displayValue('hello', {})).toEqual({ text: 'hello', kind: 'text' })
  })

  test('a DATE column renders as a calendar date', () => {
    const date = new Date('2026-01-15T00:00:00Z')
    expect(displayValue(date, { kind: 'date' })).toEqual({ text: '2026-01-15', kind: 'date' })
  })

  test('a TIMESTAMP column renders as UTC time with zero milliseconds trimmed', () => {
    expect(displayValue(new Date('2026-01-15T10:30:00.000Z'), { kind: 'timestamp' })).toEqual({
      text: '2026-01-15T10:30:00Z',
      kind: 'date'
    })
    expect(displayValue(new Date('2026-01-15T10:30:00.123Z'), { kind: 'timestamp' }).text).toBe(
      '2026-01-15T10:30:00.123Z'
    )
  })

  test('a Date in a column with no kind still renders as a timestamp', () => {
    expect(displayValue(new Date('2026-01-15T10:30:00Z'), {}).text).toBe('2026-01-15T10:30:00Z')
  })

  test('binary shows as hex, capped', () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
    expect(displayValue(bytes, {})).toEqual({ text: 'de ad be ef', kind: 'binary' })
    const long = new Uint8Array(64).fill(0xab)
    expect(displayValue(long, {}).text).toBe(
      `${Array.from(long.subarray(0, 32), (b) => b.toString(16).padStart(2, '0')).join(' ')} … (64 bytes)`
    )
  })

  test('nested values show as compact JSON with bigints as text', () => {
    expect(displayValue({ a: 1n, b: null }, {})).toEqual({ text: '{"a":"1","b":null}', kind: 'json' })
    expect(displayValue([1, 2, [3]], {}).text).toBe('[1,2,[3]]')
    // JSON.stringify alone would throw on a bigint: the whole point of the replacer.
    expect(() => JSON.stringify({ a: 1n })).toThrow()
  })

  test('renderedText caps what reaches the DOM', () => {
    expect(renderedText('a'.repeat(1001))).toHaveLength(1000)
    expect(renderedText('short')).toBe('short')
  })

  test('escapeHtml neutralizes markup', () => {
    expect(escapeHtml('<img src="x">&\'')).toBe('&lt;img src=&quot;x&quot;&gt;&amp;&#39;')
  })

  test('formatTimestamp keeps extended years parsable', () => {
    expect(formatTimestamp(new Date('2026-01-15T10:30:00.500Z'))).toBe('2026-01-15T10:30:00.500Z')
  })
})

describe('vendored gzip', () => {
  test('decompresses back-to-back gzip members, which plain fflate refuses', () => {
    const input = new Uint8Array([...gzipSync('hello'), ...gzipSync('world')])
    const output = gunzip(input, new Uint8Array(10))
    expect(new TextDecoder().decode(output)).toBe('helloworld')
  })

  test('decompresses a single member into a right-sized buffer', () => {
    const output = gunzip(new Uint8Array(gzipSync('hello')), new Uint8Array(5))
    expect(new TextDecoder().decode(output)).toBe('hello')
  })
})
