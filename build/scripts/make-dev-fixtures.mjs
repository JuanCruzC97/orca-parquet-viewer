// Generates the two development fixtures that exercise the viewer at scale:
//   big.parquet  — 200,000 rows × 6 columns in one row group (virtualization + window cache)
//   wide.parquet — 100 rows × 60 columns (column-range reads past the wide threshold)
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parquetWriteBuffer } from 'hyparquet-writer'

export const FIXTURES_DIR = process.env.PARQUET_FIXTURES ?? '/tmp/opencode/parquet-fixtures'

export function makeBigFixture() {
  const rows = 200_000
  const ids = new Array(rows)
  const names = new Array(rows)
  const values = new Array(rows)
  const flags = new Array(rows)
  const counts = new Array(rows)
  const labels = new Array(rows)
  for (let i = 0; i < rows; i++) {
    ids[i] = BigInt(i)
    names[i] = `row-${i}`
    values[i] = i * 0.5
    flags[i] = i % 2 === 0
    counts[i] = i % 1000
    labels[i] = i % 10 === 0 ? null : `label-${i % 97}`
  }
  const buffer = parquetWriteBuffer({
    columnData: [
      { name: 'id', data: ids, type: 'INT64' },
      { name: 'name', data: names, type: 'STRING' },
      { name: 'value', data: values, type: 'DOUBLE' },
      { name: 'flag', data: flags, type: 'BOOLEAN' },
      { name: 'count', data: counts, type: 'INT32' },
      { name: 'label', data: labels, type: 'STRING' }
    ]
  })
  const file = path.join(FIXTURES_DIR, 'big.parquet')
  mkdirSync(FIXTURES_DIR, { recursive: true })
  writeFileSync(file, Buffer.from(buffer))
  return file
}

export function makeWideFixture() {
  const rows = 100
  const columnData = []
  for (let c = 0; c < 60; c++) {
    const data = new Array(rows)
    for (let r = 0; r < rows; r++) data[r] = `c${c}-${r}`
    columnData.push({ name: `column_${String(c).padStart(2, '0')}`, data, type: 'STRING' })
  }
  const buffer = parquetWriteBuffer({ columnData })
  const file = path.join(FIXTURES_DIR, 'wide.parquet')
  mkdirSync(FIXTURES_DIR, { recursive: true })
  writeFileSync(file, Buffer.from(buffer))
  return file
}

if (import.meta.main) {
  console.log(makeBigFixture())
  console.log(makeWideFixture())
}
