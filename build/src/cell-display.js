// Turns a decoded parquet value into grid text, and names the kind for the CSS to align and
// dim it. hyparquet hands us: null/undefined, boolean, number, bigint, string, Date (DATE and
// TIMESTAMP columns), Array (LIST), plain object (STRUCT, MAP, JSON) and Uint8Array (binary).

// Matches the spreadsheet editor: long cells are clipped, not wrapped, and anything past this
// is dropped before rendering so a single pathological value cannot cost megabytes of DOM.
const MAX_RENDERED_TEXT = 1000

const jsonReplacer = (_, value) => (typeof value === 'bigint' ? value.toString() : value)

/** Compact JSON for nested values, with BigInt turned into text (JSON.stringify cannot). */
function toJson(value) {
  return JSON.stringify(value, jsonReplacer)
}

/** Formats a Date from a TIMESTAMP column: UTC, ISO-like, no trailing zeros. */
export function formatTimestamp(date) {
  const iso = date.toISOString()
  return iso.endsWith('.000Z') ? iso.slice(0, -5) + 'Z' : iso
}

/** Formats a Date from a DATE column: the calendar date, as stored (UTC midnight). */
export function formatDate(date) {
  return date.toISOString().slice(0, 10)
}

/**
 * @param {any} value a decoded parquet value
 * @param {{ kind: string }} column the column's type label, for date formatting
 * @returns {{ text: string, kind: 'null' | 'boolean' | 'number' | 'date' | 'json' | 'text' | 'binary' }}
 */
export function displayValue(value, column) {
  if (value === null || value === undefined) return { text: 'null', kind: 'null' }
  if (typeof value === 'boolean') return { text: String(value), kind: 'boolean' }
  if (typeof value === 'bigint') return { text: value.toString(), kind: 'number' }
  if (typeof value === 'number') {
    // NaN and Infinity are legal FLOAT/DOUBLE values; String renders them all.
    return { text: String(value), kind: 'number' }
  }
  if (typeof value === 'string') return { text: value, kind: 'text' }
  if (value instanceof Date) {
    if (column.kind === 'date') return { text: formatDate(value), kind: 'date' }
    if (column.kind === 'timestamp') return { text: formatTimestamp(value), kind: 'date' }
    return { text: formatTimestamp(value), kind: 'date' }
  }
  if (value instanceof Uint8Array) {
    const head = Array.from(value.subarray(0, 32), (byte) => byte.toString(16).padStart(2, '0')).join(' ')
    const text = value.byteLength > 32 ? `${head} … (${value.byteLength} bytes)` : value.byteLength ? head : '(empty)'
    return { text, kind: 'binary' }
  }
  if (Array.isArray(value)) return { text: toJson(value), kind: 'json' }
  if (typeof value === 'object') return { text: toJson(value), kind: 'json' }
  return { text: String(value), kind: 'text' }
}

/** Cell text capped for rendering. */
export function renderedText(text) {
  return text.length > MAX_RENDERED_TEXT ? text.slice(0, MAX_RENDERED_TEXT) : text
}

/** Escapes text for innerHTML. */
export function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
