// Orca custom editor for Apache Parquet files. Orca's document session owns the buffer and
// saving; this frame is a read-only viewer. The footer is parsed once, the grid virtualizes
// both axes, and rows are read in windows as the person scrolls, so a file with millions of
// rows opens as fast as one with ten.
import { displayValue } from './cell-display.js'
import { createGridView } from './grid-view.js'
import { MESSAGES } from './messages.js'
import { renderMetadata } from './metadata-view.js'
import { describeReadError, openParquet, readWindow } from './parquet-reader.js'

const GRID_FONT = '12px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
// Beyond this many columns a window reads only the columns on screen: a 2,000-column file
// scrolls vertically without ever decoding the columns it does not show.
const WIDE_COLUMN_THRESHOLD = 40
const BASE_WINDOW_ROWS = 2_000
const MAX_WINDOW_ROWS = 30_000
const MAX_CACHED_WINDOWS = 8

const $ = (id) => document.getElementById(id)
const ui = {
  message: $('message'),
  workbook: $('workbook'),
  notice: $('notice'),
  gridHost: $('grid-host'),
  sheetMessage: $('sheet-message'),
  metadata: $('metadata'),
  tabs: $('tabs'),
  dims: $('status-dims'),
  note: $('status-note'),
  live: $('live')
}

const countFormat = new Intl.NumberFormat(undefined)
const measureContext = document.createElement('canvas').getContext('2d')
measureContext.font = GRID_FONT
function measureText(text) {
  return measureContext.measureText(String(text)).width
}

let file = null
let loadToken = 0
let view = 'data'
let metadataRendered = false
let initialFitDone = false
let windowRows = BASE_WINDOW_ROWS
/** Window index → entry: `{ rowStart, rowEnd, colRange, promise, rows, failedColumns, error }`. */
const windows = new Map()

const grid = createGridView(ui.gridHost, {
  measureText,
  getCell: cellAt,
  onVisibleChange: onViewport
})
grid.element.id = 'grid'

function showMessage(text) {
  ui.workbook.hidden = true
  ui.message.hidden = false
  ui.message.textContent = text
  announce(text)
}

/** The grid's cell source: a loaded value, a failed column, or null while the window reads. */
function cellAt(r, c) {
  if (!file) return null
  const column = file.columns[c]
  if (!column) return null
  const entry = windows.get(Math.floor(r / windowRows))
  if (!entry || !entry.rows) return null
  if (entry.colRange !== 'all' && (c < entry.colRange.c0 || c > entry.colRange.c1)) return null
  const failed = entry.failedColumns.find((reason) => reason.name === column.name)
  if (failed) return { text: '✕', kind: 'failed', title: failed.reason }
  const row = entry.rows[r - entry.rowStart]
  return displayValue(row?.[column.name], column)
}

/** Loads (and keeps warm) the row windows the grid can see, plus one on each side. */
function onViewport(r0, r1, c0, c1) {
  if (!file) return
  if (view !== 'data') return
  const narrow = file.columns.length <= WIDE_COLUMN_THRESHOLD
  const colRange = narrow ? 'all' : { c0: Math.max(0, c0 - 3), c1: Math.min(file.columns.length - 1, c1 + 3) }
  const lastWindow = Math.max(0, Math.floor(Math.max(0, file.rowCount - 1) / windowRows))
  const w0 = Math.max(0, Math.floor(Math.max(0, r0) / windowRows) - 1)
  const w1 = Math.min(lastWindow, Math.floor(Math.max(0, r1) / windowRows) + 1)
  const wanted = new Set()
  for (let w = w0; w <= w1; w++) wanted.add(w)
  for (const w of wanted) ensureWindow(w, colRange)
  evict(wanted, Math.floor(Math.max(0, r0) / windowRows))
  updateNote()
}

function ensureWindow(w, colRange) {
  const rowStart = w * windowRows
  if (rowStart >= file.rowCount) return
  const rowEnd = Math.min(file.rowCount, rowStart + windowRows)
  const entry = windows.get(w)
  if (entry && covers(entry.colRange, colRange)) return
  const names = colRange === 'all' ? file.columns.map((column) => column.name) : columnsInRange(colRange)
  const next = { rowStart, rowEnd, colRange, promise: null, rows: null, failedColumns: [], error: null }
  windows.set(w, next)
  const token = loadToken
  next.promise = readWindow(file.bytes, file.metadata, names, rowStart, rowEnd)
  next.promise.then(
    (result) => {
      if (token !== loadToken || windows.get(w) !== next) return
      next.rows = result.rows
      next.failedColumns = result.failedColumns
      grid.refresh()
      // Why: the opening width only knows the header; once the first rows are here, fit the
      // columns on screen to the values they actually hold.
      if (!initialFitDone && w === 0) {
        initialFitDone = true
        grid.fitVisibleColumns()
      }
      updateNote()
    },
    (error) => {
      if (token !== loadToken || windows.get(w) !== next) return
      next.error = describeReadError(error)
      grid.refresh()
      updateNote()
    }
  )
}

/** Column names for a column-range window read. */
function columnsInRange(colRange) {
  const names = []
  for (let c = colRange.c0; c <= colRange.c1; c++) names.push(file.columns[c].name)
  return names
}

function covers(have, needed) {
  if (have === 'all') return true
  if (needed === 'all') return false
  return have.c0 <= needed.c0 && have.c1 >= needed.c1
}

/** Drops the cached windows farthest from view when the cache grows past its bound. */
function evict(wanted, current) {
  if (windows.size <= MAX_CACHED_WINDOWS) return
  const keys = [...windows.keys()].filter((key) => !wanted.has(key))
  keys.sort((a, b) => Math.abs(b - current) - Math.abs(a - current))
  while (windows.size > MAX_CACHED_WINDOWS && keys.length) windows.delete(keys.shift())
}

function updateNote() {
  let reading = false
  let reason = ''
  for (const entry of windows.values()) {
    if (!entry.rows) reading = true
    else if (entry.error) reason ||= entry.error
    else if (entry.failedColumns.length) reason ||= entry.failedColumns[0].reason
  }
  const text = reading ? MESSAGES.loadingRows : reason
  if (ui.note.textContent !== text) {
    ui.note.textContent = text
    if (reason && !reading) announce(reason)
  }
}

// --- Views --------------------------------------------------------------------------------------

function showView(next) {
  view = next
  const metadataTab = $('tab-metadata')
  const dataTab = $('tab-data')
  dataTab.setAttribute('aria-selected', String(next === 'data'))
  metadataTab.setAttribute('aria-selected', String(next === 'metadata'))
  ui.gridHost.hidden = next !== 'data'
  ui.sheetMessage.hidden = true
  ui.metadata.hidden = next !== 'metadata'
  if (next === 'metadata') {
    if (!metadataRendered && file) {
      renderMetadata(ui.metadata, file)
      metadataRendered = true
    }
  } else {
    grid.focus()
  }
}

ui.tabs.addEventListener('click', (event) => {
  const tab = event.target.closest('button')
  if (!tab) return
  showView(tab.id === 'tab-metadata' ? 'metadata' : 'data')
})
ui.tabs.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  showView(event.key === 'ArrowRight' ? (view === 'data' ? 'metadata' : 'data') : view === 'metadata' ? 'data' : 'metadata')
  const selected = view === 'data' ? $('tab-data') : $('tab-metadata')
  selected.focus()
})

// --- Opening ------------------------------------------------------------------------------------

function announce(text) {
  // Why: re-setting the same text is not re-announced; clearing first makes it a new message.
  ui.live.textContent = ''
  requestAnimationFrame(() => (ui.live.textContent = text))
}

function renderNotice() {
  const missing = file.unsupportedCodecs
  ui.notice.hidden = missing.length === 0
  ui.notice.textContent =
    missing.length === 0 ? '' : MESSAGES.partiallyUnsupported(missing.join(', '))
}

function renderDims() {
  const groups = file.rowGroups.length
  ui.dims.textContent =
    `${countFormat.format(file.rowCount)} ${file.rowCount === 1 ? 'row' : 'rows'} × ` +
    `${countFormat.format(file.columns.length)} ${file.columns.length === 1 ? 'column' : 'columns'} · ` +
    `${countFormat.format(groups)} row ${groups === 1 ? 'group' : 'groups'}`
}

/** Opens the file Orca handed us, replacing whatever was open before. */
function receive(bytes) {
  const token = ++loadToken
  file = null
  windows.clear()
  metadataRendered = false
  initialFitDone = false
  showMessage(MESSAGES.opening)
  // Why: let "Opening" paint before the footer parse, which holds the main thread briefly.
  setTimeout(async () => {
    if (token !== loadToken) return
    const result = await openParquet(bytes)
    if (token !== loadToken) return
    if (result.status !== 'ok') {
      showMessage(MESSAGES[result.status] ?? MESSAGES.damaged)
      return
    }
    file = result.file
    // Window size follows the file: big row groups amortize their re-reads with big windows.
    const maxGroupRows = file.rowGroups.reduce((max, group) => Math.max(max, group.rowCount), 0)
    windowRows = Math.min(MAX_WINDOW_ROWS, Math.max(BASE_WINDOW_ROWS, Math.ceil(maxGroupRows / 4)))
    ui.message.hidden = true
    ui.workbook.hidden = false
    renderNotice()
    renderDims()
    const empty = file.rowCount === 0
    ui.sheetMessage.hidden = !empty
    ui.sheetMessage.textContent = empty ? MESSAGES.noRows : ''
    grid.setModel({ rowCount: file.rowCount, columns: file.columns })
    showView('data')
    if (!empty) grid.focus()
    announce(
      empty
        ? MESSAGES.noRows
        : `${countFormat.format(file.rowCount)} rows, ${countFormat.format(file.columns.length)} columns`
    )
  }, 0)
}

showMessage(MESSAGES.opening)

window.orca.document
  .session({ decode: (content) => content.bytes })
  .then((started) => {
    started.onReplace((next) => receive(next))
    receive(started.value)
  })
  .catch(() => showMessage(MESSAGES.readFailed))
