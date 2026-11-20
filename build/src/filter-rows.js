// Per-column filters for the grid's filter row. A filter is a case-insensitive contains match
// on the displayed value, unless the column is numeric or date-like and the text uses an
// explicit comparison, negation or inclusive range:
//
//   >100   >=100   <100   <=100   =100   !=100   100..200
//
// Comparisons run on decoded values, so big integers stay exact and timestamps compare by
// instant. Nulls never match a comparison; "null" still finds them through contains.

import { displayValue } from './cell-display.js'

const NUMERIC_LABEL = /^(?:u?int\d*|float\d*|double|decimal\()/
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/
const INTEGER = /^[+-]?\d+$/
const DATE = /^\d{4}-\d{2}-\d{2}(?:[T ].+)?$/
const OP = /^(>=|<=|!=|<>|=|>|<)\s*(.+)$/
const RANGE = /^(.+?)\.\.(.+)$/

/** Compiles one filter-row value into a predicate, or null when the input is empty. */
export function compileFilter(text, column) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return null
  const spec = parseSpec(trimmed)
  if (spec) {
    const kind = filterKind(column)
    const predicate = kind === 'number' ? numberPredicate(spec) : kind === 'date' ? datePredicate(spec) : null
    if (predicate) return predicate
  }
  const needle = trimmed.toLowerCase()
  return (value) => displayText(value, column).toLowerCase().includes(needle)
}

function filterKind(column) {
  if (column.kind === 'date' || column.kind === 'timestamp') return 'date'
  if (NUMERIC_LABEL.test(column.label ?? '')) return 'number'
  return 'text'
}

function parseSpec(text) {
  const range = RANGE.exec(text)
  if (range) return { operator: 'range', low: range[1].trim(), high: range[2].trim() }
  const match = OP.exec(text)
  if (match) return { operator: match[1], operand: match[2].trim() }
  return null
}

function displayText(value, column) {
  if (typeof value === 'string') return value
  return displayValue(value, column).text
}

// --- Numbers ------------------------------------------------------------------------------------

function parseNumber(text) {
  if (!NUMBER.test(text)) return null
  return {
    number: Number(text),
    bigint: INTEGER.test(text) ? BigInt(text) : null
  }
}

function compareNumber(value, target) {
  if (value === null || value === undefined) return null
  if (typeof value === 'bigint' && target.bigint !== null) {
    return value < target.bigint ? -1 : value > target.bigint ? 1 : 0
  }
  const number = Number(value)
  if (!Number.isFinite(number) || !Number.isFinite(target.number)) return null
  return number < target.number ? -1 : number > target.number ? 1 : 0
}

function numberPredicate(spec) {
  if (spec.operator === 'range') {
    const low = parseNumber(spec.low)
    const high = parseNumber(spec.high)
    if (!low || !high) return null
    return (value) => {
      const atLow = compareNumber(value, low)
      const atHigh = compareNumber(value, high)
      return atLow !== null && atHigh !== null && atLow >= 0 && atHigh <= 0
    }
  }
  const target = parseNumber(spec.operand)
  if (!target) return null
  return (value) => compareOperator(compareNumber(value, target), spec.operator)
}

function compareOperator(compared, operator) {
  if (compared === null) return false
  switch (operator) {
    case '>': return compared > 0
    case '>=': return compared >= 0
    case '<': return compared < 0
    case '<=': return compared <= 0
    case '=': return compared === 0
    case '!=':
    case '<>': return compared !== 0
    default: return false
  }
}

// --- Dates --------------------------------------------------------------------------------------

const DAY = 86_400_000 - 1

function parseDate(text) {
  if (!DATE.test(text)) return null
  // Why: the viewer prints UTC. A date-time without an offset should mean UTC too, not the
  // browser's local zone.
  const withT = text.replace(' ', 'T')
  const normalized = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(withT) ? withT : `${withT}Z`
  const time = Date.parse(text.includes('T') || text.includes(' ') ? normalized : text)
  if (!Number.isFinite(time)) return null
  return { time, dateOnly: /^\d{4}-\d{2}-\d{2}$/.test(text) }
}

function dateValue(value) {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

function datePredicate(spec) {
  if (spec.operator === 'range') {
    const low = parseDate(spec.low)
    const high = parseDate(spec.high)
    if (!low || !high) return null
    const start = low.time
    // Why: a date-only end bound means the whole day, so 2025-12-31 includes its timestamps.
    const end = high.dateOnly ? high.time + DAY : high.time
    return (value) => {
      const time = dateValue(value)
      return time !== null && time >= start && time <= end
    }
  }
  const target = parseDate(spec.operand)
  if (!target) return null
  if (target.dateOnly) {
    const start = target.time
    const end = start + DAY
    return (value) => {
      const time = dateValue(value)
      if (time === null) return false
      switch (spec.operator) {
        case '>': return time > end
        case '>=': return time >= start
        case '<': return time < start
        case '<=': return time <= end
        case '=': return time >= start && time <= end
        case '!=':
        case '<>': return time < start || time > end
        default: return false
      }
    }
  }
  return (value) => {
    const time = dateValue(value)
    return time === null ? false : compareOperator(time - target.time, spec.operator)
  }
}
