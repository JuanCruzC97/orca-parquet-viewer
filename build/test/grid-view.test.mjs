import { describe, expect, test } from 'bun:test'
import { Window } from 'happy-dom'

const window = new Window({ url: 'https://localhost/' })
Object.assign(globalThis, {
  window,
  document: window.document,
  Element: window.Element,
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
    onSortColumn: options.onSortColumn
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
