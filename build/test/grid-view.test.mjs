import { describe, expect, test } from 'bun:test'
import { Window } from 'happy-dom'

const window = new Window({ url: 'https://localhost/' })
Object.assign(globalThis, {
  window,
  document: window.document,
  Element: window.Element,
  KeyboardEvent: window.KeyboardEvent,
  MouseEvent: window.MouseEvent,
  PointerEvent: window.PointerEvent
})
class ResizeObserver {
  observe() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserver

const { createGridView } = await import('../src/grid-view.js')

// A stand-in for canvas measureText: every character is 7px wide.
const measureText = (text) => String(text).length * 7

function mount(values, options = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const grid = createGridView(host, {
    measureText,
    getCell: (r, c) => {
      if (c !== 0) return { text: 'USD', kind: 'text' }
      const value = values[r]
      return value === undefined ? null : { text: value, kind: 'date' }
    },
    onVisibleChange: () => {},
    onSortColumn: options.onSortColumn,
    onFilterChange: options.onFilterChange,
    onClearFilters: options.onClearFilters
  })
  grid.setModel({
    rowCount: values.length,
    columns: [
      { name: 'date', label: 'timestamp[us]', kind: 'timestamp' },
      { name: 'currency', label: 'string', kind: 'text' }
    ]
  })
  return { host, grid }
}

function press(host, type, clientX) {
  host.querySelector('.col-resize').dispatchEvent(
    new window.PointerEvent(type, { bubbles: true, button: 0, clientX })
  )
}

describe('grid columns', () => {
  test('headers stack the name above the type', () => {
    const { host, grid } = mount(['2026-01-15T10:30:00Z'])
    expect(host.querySelector('.col-name').textContent).toBe('date')
    expect(host.querySelector('.col-type').textContent).toBe('timestamp[us]')
    grid.destroy()
  })

  test('dragging a header edge resizes that column', () => {
    const { host, grid } = mount(['2026-01-15T10:30:00Z'])
    const before = parseInt(host.querySelector('.col-head').style.width, 10)
    press(host, 'pointerdown', 100)
    window.dispatchEvent(new window.PointerEvent('pointermove', { clientX: 160 }))
    window.dispatchEvent(new window.PointerEvent('pointerup', { clientX: 160 }))
    expect(parseInt(host.querySelector('.col-head').style.width, 10)).toBe(before + 60)
    grid.destroy()
  })

  test('double-clicking a header edge fits the widest value', () => {
    const { host, grid } = mount(['2026-01-15T10:30:00Z', 'short'])
    expect(parseInt(host.querySelector('.col-head').style.width, 10)).toBe(measureText('timestamp[us]') + 22)
    host.querySelector('.col-resize').dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }))
    expect(parseInt(host.querySelector('.col-head').style.width, 10)).toBe(measureText('2026-01-15T10:30:00Z') + 22)
    grid.destroy()
  })

  test('clicking a header asks to sort that column', () => {
    const sorted = []
    const { host, grid } = mount(['2026-01-15T10:30:00Z'], { onSortColumn: (column) => sorted.push(column) })
    const header = host.querySelectorAll('.col-head')[1]
    header.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(sorted).toEqual([1])
    grid.destroy()
  })

  test('a sorted header shows its direction and readable state', () => {
    const { host, grid } = mount(['2026-01-15T10:30:00Z'])
    grid.setSort({ column: 0, direction: -1 })
    const header = host.querySelector('.col-head')
    expect(header.getAttribute('aria-sort')).toBe('descending')
    expect(header.querySelector('.col-sort').textContent).toBe('▼')
    expect(header.classList.contains('sorted')).toBe(true)
    grid.setSort(null)
    expect(host.querySelector('.col-head').hasAttribute('aria-sort')).toBe(false)
    expect(host.querySelector('.col-sort')).toBeNull()
    grid.destroy()
  })
})

describe('grid filters', () => {
  test('renders one input per column and reports typing', () => {
    const changes = []
    const { host, grid } = mount(['2026-01-15T10:30:00Z'], {
      onFilterChange: (column, text) => changes.push([column, text])
    })
    const inputs = host.querySelectorAll('.filter-input')
    expect(inputs).toHaveLength(2)
    expect(inputs[0].getAttribute('aria-label')).toBe('Filter date')
    inputs[1].value = 'USD'
    inputs[1].dispatchEvent(new window.Event('input', { bubbles: true }))
    expect(changes).toEqual([[1, 'USD']])
    grid.destroy()
  })

  test('setFilters fills the visible inputs and clears them on demand', () => {
    const cleared = []
    const { host, grid } = mount(['2026-01-15T10:30:00Z'], { onClearFilters: () => cleared.push(true) })
    grid.setFilters(['2026', 'USD'])
    expect([...host.querySelectorAll('.filter-input')].map((input) => input.value)).toEqual(['2026', 'USD'])
    expect(host.querySelector('.filter-clear').disabled).toBe(false)
    host.querySelector('.filter-clear').click()
    expect([...host.querySelectorAll('.filter-input')].map((input) => input.value)).toEqual(['', ''])
    expect(host.querySelector('.filter-clear').disabled).toBe(true)
    expect(cleared).toEqual([true])
    grid.destroy()
  })

  test('Escape clears the focused filter', () => {
    const changes = []
    const { host, grid } = mount(['2026-01-15T10:30:00Z'], {
      onFilterChange: (column, text) => changes.push([column, text])
    })
    const input = host.querySelectorAll('.filter-input')[1]
    input.value = 'USD'
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    input.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    expect(input.value).toBe('')
    expect(changes).toEqual([[1, 'USD'], [1, '']])
    grid.destroy()
  })

  test('keeps the header and filters visible when a view has no rows', () => {
    const { host, grid } = mount(['2026-01-15T10:30:00Z'])
    grid.setEmptyMessage('No rows match these filters.')
    grid.setRowCount(0)
    expect(host.querySelectorAll('.col-head')).toHaveLength(2)
    expect(host.querySelectorAll('.filter-input')).toHaveLength(2)
    expect(host.querySelector('.grid-empty').hidden).toBe(false)
    expect(host.querySelector('.grid-empty').textContent).toBe('No rows match these filters.')
    grid.setRowCount(1)
    expect(host.querySelector('.grid-empty').hidden).toBe(true)
    grid.destroy()
  })
})
