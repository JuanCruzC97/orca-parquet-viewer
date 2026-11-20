import { describe, expect, test } from 'bun:test'
import { Window } from 'happy-dom'

const window = new Window()
globalThis.document = window.document

const { formatBytes, renderMetadata } = await import('../src/metadata-view.js')

const element = (schemaElement) => ({
  element: schemaElement,
  children: [],
  count: 1,
  path: [schemaElement.name]
})

/** A file shaped like openParquet's answer, covering each section's branches. */
const fakeFile = {
  rowCount: 1_234,
  rowGroups: [
    {
      index: 0,
      firstRow: 0,
      rowCount: 1_234,
      compressed: 250_000n,
      uncompressed: 600_000n,
      codecs: ['SNAPPY'],
      chunks: []
    }
  ],
  columns: [{ name: 'id', label: 'int64' }, { name: 'payload', label: 'json' }],
  codecs: ['SNAPPY'],
  unsupportedCodecs: [],
  keyValueMetadata: [
    { key: 'pandas', value: '{"columns":["a","b"],"index":["x"]}' },
    { key: 'plain', value: 'just text' },
    { key: 'unset' }
  ],
  createdBy: 'parquet-cpp-arrow version 16.1.0',
  version: 2,
  bytes: { byteLength: 250_000 },
  schemaTree: {
    element: { name: 'schema', num_children: 2 },
    children: [
      element({ name: 'id', type: 'INT64', repetition_type: 'REQUIRED' }),
      {
        element: { name: 'payload', type: 'BYTE_ARRAY', converted_type: 'JSON', repetition_type: 'OPTIONAL' },
        children: [element({ name: 'nested', type: 'INT32', repetition_type: 'OPTIONAL', logical_type: { type: 'DATE' } })],
        count: 1,
        path: ['payload']
      }
    ]
  }
}

describe('renderMetadata', () => {
  test('renders the four sections', () => {
    const host = document.createElement('div')
    renderMetadata(host, fakeFile)
    const sections = host.querySelectorAll('.meta-section')
    expect(sections.length).toBe(4)
    expect(sections[0].querySelector('.meta-title').textContent).toBe('File')
    expect(sections[1].querySelector('.meta-title').textContent).toBe('Schema')
    expect(sections[2].querySelector('.meta-title').textContent).toBe('Row groups')
    expect(sections[3].querySelector('.meta-title').textContent).toBe('Key-value metadata')
  })

  test('the File section states the facts', () => {
    const host = document.createElement('div')
    renderMetadata(host, fakeFile)
    const facts = [...host.querySelectorAll('.meta-fact')].map(
      (fact) => fact.querySelector('.meta-term').textContent + '=' + fact.querySelector('.meta-value').textContent
    )
    expect(facts).toContain('Rows=1,234')
    expect(facts).toContain('Row groups=1')
    expect(facts).toContain('File size=244.1 KB')
    expect(facts).toContain('Compression=SNAPPY')
    expect(facts).toContain('Created by=parquet-cpp-arrow version 16.1.0')
  })

  test('the schema tree nests children with types and repetition', () => {
    const host = document.createElement('div')
    renderMetadata(host, fakeFile)
    const names = [...host.querySelectorAll('.schema-name')].map((node) => node.textContent)
    expect(names).toEqual(['id', 'payload', 'nested'])
    const payload = host.querySelectorAll('.schema-head')[1]
    expect(payload.querySelector('.schema-type').textContent).toBe('json')
    expect(payload.querySelector('.schema-repetition').textContent).toBe('optional')
    const nested = host.querySelectorAll('.schema-head')[2]
    expect(nested.querySelector('.schema-type').textContent).toBe('date')
    expect(nested.querySelector('.schema-repetition').textContent).toBe('optional')
  })

  test('row groups list their size, codec and row range', () => {
    const host = document.createElement('div')
    renderMetadata(host, fakeFile)
    const item = host.querySelector('.group-item')
    expect(item.querySelector('.group-rows').textContent).toBe('1,234 rows')
    expect(item.querySelector('.group-codecs').textContent).toBe('SNAPPY')
    expect(item.querySelector('.group-range').textContent).toBe('rows 1 – 1,234')
    expect(item.className).not.toContain('warn')
  })

  test('an unsupported codec warns on its row group', () => {
    const host = document.createElement('div')
    renderMetadata(host, {
      ...fakeFile,
      unsupportedCodecs: ['BROTLI'],
      rowGroups: [{ ...fakeFile.rowGroups[0], codecs: ['BROTLI'] }]
    })
    expect(host.querySelector('.group-item').className).toContain('warn')
  })

  test('key-value metadata pretty-prints JSON and tolerates missing values', () => {
    const host = document.createElement('div')
    renderMetadata(host, fakeFile)
    const details = [...host.querySelectorAll('.kv')]
    expect(details.map((detail) => detail.querySelector('.kv-key').textContent)).toEqual(['pandas', 'plain', 'unset'])
    const pretty = details[0].querySelector('.kv-value').textContent
    expect(pretty).toContain('"columns"')
    expect(pretty).toContain('\n')
    expect(details[1].querySelector('.kv-value').textContent).toBe('just text')
    expect(details[2].querySelector('.meta-empty').textContent).toContain('no value')
  })

  test('huge values are capped', () => {
    const host = document.createElement('div')
    renderMetadata(host, {
      ...fakeFile,
      keyValueMetadata: [{ key: 'big', value: 'x'.repeat(30_000) }]
    })
    const value = host.querySelector('.kv-value').textContent
    expect(value.length).toBeLessThan(22_000)
    expect(value).toContain('truncated')
  })
})

describe('formatBytes', () => {
  test('sizes read naturally', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(999)).toBe('999 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(250_000n)).toBe('244.1 KB')
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB')
  })
})
