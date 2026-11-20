// Generates known.parquet: a small file with exact values across the types the viewer formats
// distinctly — bigint, double, boolean and string columns with nulls. Run by the tests on demand,
// and usable as a development fixture: `orca plugin open local.parquet-viewer --editor <file>`.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parquetWriteBuffer } from 'hyparquet-writer'

export const FIXTURES_DIR = process.env.PARQUET_FIXTURES ?? '/tmp/opencode/parquet-fixtures'

/** The exact rows every assertion in the reader tests is written against. */
export const KNOWN_ROWS = [
  { id: 1n, name: 'Alice', score: 1.5, active: true, count: 10 },
  { id: 2n, name: 'Bob', score: 2.25, active: false, count: 20 },
  { id: 3n, name: null, score: 3.125, active: true, count: 30 },
  { id: 4n, name: 'Diana', score: null, active: false, count: 40 },
  { id: 5n, name: 'Eve', score: 5.0, active: null, count: 50 }
]

/** Writes the fixture and returns its path. */
export function makeKnownFixture() {
  const buffer = parquetWriteBuffer({
    columnData: [
      { name: 'id', data: KNOWN_ROWS.map((row) => row.id), type: 'INT64' },
      { name: 'name', data: KNOWN_ROWS.map((row) => row.name), type: 'STRING' },
      { name: 'score', data: KNOWN_ROWS.map((row) => row.score), type: 'DOUBLE' },
      { name: 'active', data: KNOWN_ROWS.map((row) => row.active), type: 'BOOLEAN' },
      { name: 'count', data: KNOWN_ROWS.map((row) => row.count), type: 'INT32' }
    ]
  })
  const file = path.join(FIXTURES_DIR, 'known.parquet')
  mkdirSync(FIXTURES_DIR, { recursive: true })
  writeFileSync(file, Buffer.from(buffer))
  return file
}

if (import.meta.main) {
  const file = makeKnownFixture()
  console.log(file)
}
