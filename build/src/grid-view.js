// The virtualized grid. One scroll container sizes the file with an invisible spacer; a sticky
// viewport inside it stays in view and holds only the rows and columns on screen (plus
// overscan), moved with transforms, so scrolling stays native and wheel and trackpad events
// need no handling. Cells the editor has not loaded yet render as empty placeholders.
//
// The editor feeds cells through `getCell(r, c)`, which returns `{ text, kind }` for a loaded
// cell, `{ text, kind: 'failed', title }` for a column this window could not decode, or null
// while its row window is still being read.

import { createAxis } from './axis.js'
import { escapeHtml, renderedText } from './cell-display.js'

const HEADER_HEIGHT = 24
const ROW_HEIGHT = 24
const OVERSCAN_ROWS = 10
const OVERSCAN_COLUMNS = 3
const MAX_RENDERED_TEXT = 1000

/**
 * @param {HTMLElement} host
 * @param {{ measureText: (text: string) => number, getCell: (r: number, c: number) => { text: string, kind: string, title?: string } | null,
 *   onVisibleChange: (r0: number, r1: number, c0: number, c1: number) => void }} options
 */
export function createGridView(host, options) {
  host.innerHTML = `
    <div class="scroller" tabindex="-1">
      <div class="spacer" aria-hidden="true"></div>
      <div class="viewport" role="grid" tabindex="0" aria-readonly="true">
        <div class="col-header" role="rowgroup"><div class="row" role="row" aria-rowindex="1">
          <div class="corner" role="columnheader" aria-colindex="1" aria-label="Row numbers"></div>
          <div class="strip"></div>
        </div></div>
        <div class="body" role="rowgroup">
          <div class="rows"><div class="row-list"></div><div class="selection" aria-hidden="true"><div class="active"></div></div></div>
        </div>
      </div>
    </div>`
  const scroller = host.querySelector('.scroller')
  const spacer = host.querySelector('.spacer')
  const viewport = host.querySelector('.viewport')
  const headerStrip = host.querySelector('.col-header .strip')
  const corner = host.querySelector('.corner')
  const rowList = host.querySelector('.row-list')
  const activeBox = host.querySelector('.selection .active')
  const idPrefix = `g${Math.random().toString(36).slice(2, 8)}`

  let columns = []
  let columnAxis = createAxis(new Float64Array(0))
  let rowCount = 0
  let gutter = 52
  let active = { r: 0, c: 0 }
  let rendered = null
  let width = 0
  let height = 0
  let scrollX = 0
  let scrollY = 0

  function setModel(next) {
    columns = next.columns
    rowCount = next.rowCount
    columnAxis = createAxis(Float64Array.from(next.columns.map((column) => column.width)))
    gutter = Math.max(52, Math.ceil(options.measureText(String(Math.max(1, rowCount))) + 20))
    active = { r: 0, c: 0 }
    rendered = null
    viewport.setAttribute('aria-rowcount', String(rowCount + 1))
    viewport.setAttribute('aria-colcount', String(columns.length + 1))
    viewport.style.setProperty('--gutter', `${gutter}px`)
    spacer.style.width = `${gutter + columnAxis.total}px`
    spacer.style.height = `${HEADER_HEIGHT + rowCount * ROW_HEIGHT}px`
    measure()
    scroller.scrollTop = 0
    scroller.scrollLeft = 0
    onScroll()
    render()
  }

  function measure() {
    const nextWidth = scroller.clientWidth
    const nextHeight = scroller.clientHeight
    if (nextWidth === width && nextHeight === height) return false
    width = nextWidth
    height = nextHeight
    viewport.style.width = `${width}px`
    viewport.style.height = `${height}px`
    return true
  }

  function visibleWindow() {
    const top = scrollY
    const bottom = scrollY + Math.max(0, height - HEADER_HEIGHT)
    const left = scrollX
    const right = scrollX + Math.max(0, width - gutter)
    return {
      r0: clampRow(columnRowAt(top)),
      r1: clampRow(columnRowAt(Math.max(0, bottom - 1))),
      c0: columnAxis.indexAt(left),
      c1: columnAxis.indexAt(Math.max(0, right - 1))
    }
  }

  function clampRow(r) {
    return Math.min(Math.max(0, r), Math.max(0, rowCount - 1))
  }

  function columnRowAt(position) {
    return rowCount ? Math.floor(position / ROW_HEIGHT) : 0
  }

  function onScroll() {
    scrollX = scroller.scrollLeft
    scrollY = scroller.scrollTop
    viewport.style.setProperty('--sx', `${-scrollX}px`)
    host.querySelector('.rows').style.transform = `translate3d(0, ${-scrollY}px, 0)`
    const visible = visibleWindow()
    if (
      !rendered ||
      visible.r0 < rendered.r0 || visible.r1 > rendered.r1 ||
      visible.c0 < rendered.c0 || visible.c1 > rendered.c1
    ) {
      render()
    }
  }

  function render() {
    if (rowCount === 0 || columns.length === 0) return
    const visible = visibleWindow()
    const area = {
      r0: Math.max(0, visible.r0 - OVERSCAN_ROWS),
      r1: Math.min(rowCount - 1, visible.r1 + OVERSCAN_ROWS),
      c0: Math.max(0, Math.min(visible.c0, columns.length - 1) - OVERSCAN_COLUMNS),
      c1: Math.min(columns.length - 1, Math.max(visible.c0, 0) + (visible.c1 - visible.c0) + OVERSCAN_COLUMNS)
    }
    // When the viewport is wider than every column, render them all.
    if (columnAxis.total <= Math.max(0, width - gutter)) {
      area.c0 = 0
      area.c1 = columns.length - 1
    }
    rendered = area

    let header = ''
    for (let c = area.c0; c <= area.c1; c++) {
      const column = columns[c]
      header +=
        `<div class="col-head" role="columnheader" aria-colindex="${c + 2}" style="left:${columnAxis.start(c)}px;width:${columnAxis.size(c)}px"` +
        ` title="${escapeHtml(column.name)} · ${escapeHtml(column.label)}">` +
        `<span class="col-name">${escapeHtml(column.name)}</span>` +
        `<span class="col-type">${escapeHtml(column.label)}</span></div>`
    }
    headerStrip.innerHTML = header

    let html = ''
    for (let r = area.r0; r <= area.r1; r++) {
      let cells = ''
      for (let c = area.c0; c <= area.c1; c++) {
        cells += cellHtml(r, c)
      }
      html +=
        `<div class="row" role="row" aria-rowindex="${r + 2}" style="top:${r * ROW_HEIGHT}px;height:${ROW_HEIGHT}px">` +
        `<div class="row-head" role="rowheader" aria-colindex="1">${r + 1}</div>` +
        `<div class="strip">${cells}</div></div>`
    }
    rowList.innerHTML = html
    positionActive()
    if (active.r >= area.r0 && active.r <= area.r1) {
      viewport.setAttribute('aria-activedescendant', cellId(active.r, active.c))
    }
    const visibleArea = {
      r0: visible.r0,
      r1: visible.r1,
      c0: Math.min(area.c0 + OVERSCAN_COLUMNS, columns.length - 1),
      c1: Math.max(area.c1 - OVERSCAN_COLUMNS, 0)
    }
    options.onVisibleChange(visibleArea.r0, visibleArea.r1, visibleArea.c0, visibleArea.c1)
  }

  function cellHtml(r, c) {
    const cell = options.getCell(r, c)
    const widthPx = columnAxis.size(c)
    if (!cell) {
      return `<div class="cell pending" role="gridcell" id="${cellId(r, c)}" aria-colindex="${c + 2}"` +
        ` style="left:${columnAxis.start(c)}px;width:${widthPx}px"></div>`
    }
    const text = renderedText(cell.text)
    const title = cell.title ? ` title="${escapeHtml(cell.title)}"` : ''
    return (
      `<div class="cell ${cell.kind}" role="gridcell" id="${cellId(r, c)}" aria-colindex="${c + 2}"${title}` +
      ` style="left:${columnAxis.start(c)}px;width:${widthPx}px">${escapeHtml(text)}</div>`
    )
  }

  function cellId(r, c) {
    return `${idPrefix}-${r}-${c}`
  }

  function positionActive() {
    activeBox.style.left = `${columnAxis.start(active.c)}px`
    activeBox.style.top = `${active.r * ROW_HEIGHT}px`
    activeBox.style.width = `${columnAxis.size(active.c)}px`
    activeBox.style.height = `${ROW_HEIGHT}px`
  }

  function scrollIntoView(r, c) {
    const x = columnAxis.start(c)
    const x1 = columnAxis.end(c)
    const y = r * ROW_HEIGHT
    const y1 = y + ROW_HEIGHT
    const bodyWidth = width - gutter
    const bodyHeight = height - HEADER_HEIGHT
    let top = scroller.scrollTop
    let left = scroller.scrollLeft
    if (y < top) top = y
    else if (y1 > top + bodyHeight) top = Math.min(y, y1 - bodyHeight)
    if (x < left) left = x
    else if (x1 > left + bodyWidth) left = Math.min(x, x1 - bodyWidth)
    if (top !== scroller.scrollTop) scroller.scrollTop = top
    if (left !== scroller.scrollLeft) scroller.scrollLeft = left
    onScroll()
  }

  function select(r, c, reveal = true) {
    active = { r: clampRow(r), c: Math.min(Math.max(0, c), Math.max(0, columns.length - 1)) }
    if (reveal) scrollIntoView(active.r, active.c)
    render()
  }

  function onKeyDown(event) {
    if (rowCount === 0 || columns.length === 0) return
    const primary = event.ctrlKey || event.metaKey
    const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    if (event.key in arrows) {
      event.preventDefault()
      const [dr, dc] = arrows[event.key]
      if (primary) {
        // Ctrl+arrow jumps to the edge of the data, as spreadsheets do.
        const r = dr ? (dr < 0 ? 0 : rowCount - 1) : active.r
        const c = dc ? (dc < 0 ? 0 : columns.length - 1) : active.c
        select(r, c)
      } else {
        select(active.r + dr, active.c + dc)
      }
    } else if (event.key === 'PageDown' || event.key === 'PageUp') {
      event.preventDefault()
      const page = Math.max(1, Math.floor((height - HEADER_HEIGHT) / ROW_HEIGHT) - 1)
      select(active.r + (event.key === 'PageDown' ? page : -page), active.c)
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const first = event.key === 'Home'
      if (primary) select(first ? 0 : rowCount - 1, first ? 0 : columns.length - 1)
      else select(active.r, first ? 0 : columns.length - 1)
    }
  }

  function hitTest(clientX, clientY) {
    const bounds = viewport.getBoundingClientRect()
    const x = clientX - bounds.left
    const y = clientY - bounds.top
    return {
      r: clampRow(Math.floor((y - HEADER_HEIGHT + scrollY) / ROW_HEIGHT)),
      c: columnAxis.indexAt(Math.max(0, x - gutter + scrollX))
    }
  }

  function onPointerDown(event) {
    if (event.button !== 0 || rowCount === 0 || columns.length === 0) return
    const hit = hitTest(event.clientX, event.clientY)
    event.preventDefault()
    viewport.focus({ preventScroll: true })
    select(hit.r, hit.c, false)
  }

  let destroyed = false
  const resizeObserver = new ResizeObserver(() => {
    // Why: an observer callback that writes styles can schedule another notification in the same
    // frame, which the browser reports as a "ResizeObserver loop". One frame later, with a
    // no-change guard, there is no loop at all.
    requestAnimationFrame(() => {
      if (destroyed) return
      if (measure()) {
        rendered = null
        onScroll()
      }
    })
  })
  resizeObserver.observe(scroller)
  scroller.addEventListener('scroll', onScroll, { passive: true })
  viewport.addEventListener('keydown', onKeyDown)
  viewport.addEventListener('pointerdown', onPointerDown)

  return {
    element: viewport,
    setModel,
    select,
    focus: () => viewport.focus({ preventScroll: true }),
    refresh: () => {
      rendered = null
      render()
    },
    get active() {
      return active
    },
    state: () => ({ scrollTop: scroller.scrollTop, scrollLeft: scroller.scrollLeft }),
    destroy() {
      destroyed = true
      resizeObserver.disconnect()
      host.innerHTML = ''
    }
  }
}
