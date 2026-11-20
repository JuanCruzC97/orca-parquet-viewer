// The Metadata view: what a parquet-inspection tool owes its user. Everything here comes from
// the footer alone — no row data is read. Built with DOM calls, not innerHTML, so file-provided
// names and values are safe by construction.

const countFormat = new Intl.NumberFormat(undefined)
const MAX_KV_LENGTH = 20_000

/** 1234567 → '1.2 MB' */
export function formatBytes(size) {
  const bytes = Number(size)
  if (bytes < 1024) return `${countFormat.format(bytes)} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/**
 * Renders the whole metadata panel for an opened file.
 *
 * @param {HTMLElement} host the panel to fill
 * @param {object} file the value openParquet returned
 */
export function renderMetadata(host, file) {
  host.replaceChildren(
    fileFacts(file),
    schemaSection(file.schemaTree),
    rowGroupsSection(file),
    keyValueSection(file.keyValueMetadata)
  )
}

function section(title) {
  const node = element('section', 'meta-section')
  node.append(element('h2', 'meta-title', title))
  return node
}

function factRow(term, value, valueClass = '') {
  const row = element('div', 'meta-fact')
  row.append(element('dt', 'meta-term', term))
  row.append(element('dd', `meta-value${valueClass ? ` ${valueClass}` : ''}`, value))
  return row
}

function fileFacts(file) {
  const node = section('File')
  const facts = element('dl', 'meta-facts')
  facts.append(
    factRow('Rows', countFormat.format(file.rowCount)),
    factRow('Row groups', countFormat.format(file.rowGroups.length)),
    factRow('Columns', countFormat.format(file.columns.length)),
    factRow('File size', formatBytes(file.bytes.byteLength)),
    factRow('Created by', file.createdBy || 'unknown', 'meta-mono'),
    factRow('Format version', String(file.version)),
    factRow('Compression', file.codecs.length ? file.codecs.join(', ') : 'none')
  )
  node.append(facts)
  return node
}

function schemaSection(schemaTree) {
  const node = section('Schema')
  const list = element('ul', 'schema-tree')
  for (const child of schemaTree.children) renderSchemaNode(list, child, 0)
  node.append(list)
  return node
}

/** One schema node: its name, repetition and type label, with children nested under it. */
function renderSchemaNode(list, child, depth) {
  const element_ = child.element
  const item = element('li', 'schema-node')
  item.style.setProperty('--depth', String(depth))
  const head = element('div', 'schema-head')
  head.append(element('span', 'schema-name', element_.name))
  const label = typeText(element_)
  if (label) head.append(element('span', 'schema-type', label))
  const repetition = repetitionLabel(element_)
  if (repetition) head.append(element('span', 'schema-repetition', repetition))
  item.append(head)
  list.append(item)
  if (child.children.length > 0) {
    const nested = element('ul', 'schema-tree')
    for (const grandChild of child.children) renderSchemaNode(nested, grandChild, depth + 1)
    item.append(nested)
  }
}

function typeText(schemaElement) {
  if (!schemaElement.type) return 'group'
  if (schemaElement.logical_type) return logicalLabel(schemaElement.logical_type)
  if (schemaElement.converted_type) return schemaElement.converted_type.toLowerCase().replaceAll('_', ' ')
  return schemaElement.type.toLowerCase()
}

const LOGICAL_LABELS = {
  STRING: 'string',
  MAP: 'map',
  LIST: 'list',
  ENUM: 'enum',
  DATE: 'date',
  INTERVAL: 'interval',
  NULL: 'null',
  JSON: 'json',
  BSON: 'bson',
  UUID: 'uuid',
  FLOAT16: 'float16',
  GEOMETRY: 'geometry',
  GEOGRAPHY: 'geography',
  VARIANT: 'variant',
  FILE: 'file'
}

function logicalLabel(logical) {
  switch (logical.type) {
    case 'DECIMAL': return `decimal(${logical.precision},${logical.scale})`
    case 'TIME': return `time (${logical.unit.toLowerCase()})`
    case 'TIMESTAMP': return `timestamp (${logical.unit.toLowerCase()})`
    case 'INTEGER': return `${logical.isSigned ? 'int' : 'uint'}${logical.bitWidth}`
    default: return LOGICAL_LABELS[logical.type] ?? logical.type.toLowerCase()
  }
}

function repetitionLabel(schemaElement) {
  switch (schemaElement.repetition_type) {
    case 'REQUIRED': return 'required'
    case 'REPEATED': return 'repeated'
    case 'OPTIONAL': return 'optional'
    default: return ''
  }
}

function rowGroupsSection(file) {
  const node = section('Row groups')
  if (file.rowGroups.length === 0) {
    node.append(element('p', 'meta-empty', 'The file declares no row groups.'))
    return node
  }
  const list = element('ul', 'group-list')
  for (const group of file.rowGroups) {
    const item = element('li', 'group-item')
    if (group.codecs.some((codec) => file.unsupportedCodecs.includes(codec))) item.classList.add('warn')
    const line = element('div', 'group-line')
    line.append(element('span', 'group-index', `#${group.index + 1}`))
    line.append(element('span', 'group-rows', `${countFormat.format(group.rowCount)} rows`))
    const ratio = group.uncompressed > 0n ? ` · ${formatBytes(group.uncompressed)} → ${formatBytes(group.compressed)}` : ''
    line.append(element('span', 'group-size', `${formatBytes(group.compressed)} compressed${ratio ? ` · ${ratio}` : ''}`))
    line.append(element('span', 'group-codecs', group.codecs.join(', ') || 'uncompressed'))
    item.append(line)
    item.append(element('div', 'group-range', `rows ${countFormat.format(group.firstRow + 1)} – ${countFormat.format(group.firstRow + group.rowCount)}`))
    list.append(item)
  }
  node.append(list)
  return node
}

function keyValueSection(entries) {
  const node = section('Key-value metadata')
  if (entries.length === 0) {
    node.append(element('p', 'meta-empty', 'The file carries no key-value metadata.'))
    return node
  }
  for (const entry of entries) {
    const details = element('details', 'kv')
    details.append(element('summary', 'kv-key', entry.key))
    details.append(kvValue(entry.key, entry.value))
    node.append(details)
  }
  return node
}

function kvValue(key, value) {
  if (value === undefined || value === null) return element('p', 'meta-empty', '(no value)')
  let text = value
  try {
    const parsed = JSON.parse(value)
    text = JSON.stringify(parsed, (_, item) => (typeof item === 'bigint' ? item.toString() : item), 2)
  } catch {
    // Not JSON: show as-is, capped.
  }
  if (text.length > MAX_KV_LENGTH) {
    text = `${text.slice(0, MAX_KV_LENGTH)}\n… (${countFormat.format(value.length)} characters, truncated)`
  }
  const pre = element('pre', 'kv-value mono', text)
  return pre
}
