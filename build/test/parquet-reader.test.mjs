import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { corpusBytes } from '../scripts/fetch-corpus.mjs'
import { KNOWN_ROWS, makeKnownFixture } from '../scripts/make-fixture.mjs'
import { displayValue } from '../src/cell-display.js'
import { describeReadError, fileKind, openParquet, readWindow, typeLabel } from '../src/parquet-reader.js'

const knownBytes = () => {
  const buffer = readFileSync(makeKnownFixture())
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}

const textBytes = (text) => new TextEncoder().encode(text).buffer

describe('fileKind', () => {
  test('classifies the magic bytes before any parsing', async () => {
    expect(fileKind(new ArrayBuffer(0))).toBe('empty')
    expect(fileKind(new ArrayBuffer(8))).toBe('short')
    expect(fileKind(textBytes('this is definitely not a parquet file, sorry'))).toBe('notParquet')
    const truncated = new Uint8Array(await corpusBytes('alltypes_plain.parquet')).slice(0, 200)
    expect(fileKind(truncated.buffer.slice(truncated.byteOffset, truncated.byteOffset + truncated.byteLength))).toBe('truncated')
    const encrypted = await corpusBytes('uniform_encryption.parquet.encrypted')
    expect(fileKind(encrypted)).toBe('encrypted')
    expect(fileKind(knownBytes())).toBe('parquet')
  })

  test('a valid header with a corrupt footer length is damaged, not truncated', async () => {
    const bytes = knownBytes()
    const corrupt = new Uint8Array(bytes.byteLength)
    corrupt.set(new Uint8Array(bytes))
    // PAR1 is intact at both ends; only the metadata length field is nonsense.
    corrupt.set(new Uint8Array([0xff, 0xff, 0x00, 0x00]), bytes.byteLength - 8)
    const result = await openParquet(corrupt.buffer.slice(corrupt.byteOffset, corrupt.byteOffset + corrupt.byteLength))
    expect(result.status).toBe('damaged')
  })
})

describe('openParquet', () => {
  test('reads the schema, columns and row groups of a known file', async () => {
    const result = await openParquet(knownBytes())
    expect(result.status).toBe('ok')
    const file = result.file
    expect(file.rowCount).toBe(5)
    expect(file.rowGroups).toHaveLength(1)
    expect(file.rowGroups[0].rowCount).toBe(5)
    expect(file.rowGroups[0].firstRow).toBe(0)
    expect(file.codecs).toEqual(['SNAPPY'])
    expect(file.columns.map((column) => column.name)).toEqual(['id', 'name', 'score', 'active', 'count'])
    expect(file.columns.map((column) => column.label)).toEqual(['int64', 'string', 'double', 'boolean', 'int32'])
  })

  test('the impala alltypes file keeps its legacy shapes', async () => {
    const result = await openParquet(await corpusBytes('alltypes_plain.parquet'))
    expect(result.status).toBe('ok')
    const file = result.file
    expect(file.rowCount).toBe(8)
    expect(file.columns).toHaveLength(11)
    const timestamp = file.columns.find((column) => column.name === 'timestamp_col')
    expect(timestamp.label).toBe('timestamp[int96]')
    expect(timestamp.kind).toBe('timestamp')
    expect(file.unsupportedCodecs).toEqual([])
  })

  test('marks brotli row groups as unreadable up front', async () => {
    const result = await openParquet(await corpusBytes('large_string_map.brotli.parquet'))
    expect(result.status).toBe('ok')
    expect(result.file.unsupportedCodecs).toEqual(['BROTLI'])
  })

  test('classifies files Orca should never have routed here', async () => {
    expect((await openParquet(textBytes('not a parquet file at all, really'))).status).toBe('notParquet')
    expect((await openParquet(await corpusBytes('uniform_encryption.parquet.encrypted'))).status).toBe('encrypted')
  })
})

describe('readWindow', () => {
  test('returns the exact rows of the generated fixture', async () => {
    const bytes = knownBytes()
    const { file } = await openParquet(bytes)
    const { rows, failedColumns } = await readWindow(
      bytes,
      file.metadata,
      file.columns.map((column) => column.name),
      0,
      5
    )
    expect(failedColumns).toEqual([])
    expect(rows.map((row) => row.id)).toEqual([1n, 2n, 3n, 4n, 5n])
    expect(rows.map((row) => row.name)).toEqual(['Alice', 'Bob', null, 'Diana', 'Eve'])
    expect(rows.map((row) => row.score)).toEqual([1.5, 2.25, 3.125, null, 5])
    expect(rows.map((row) => row.active)).toEqual([true, false, true, false, null])
    expect(rows[0]).toEqual({ id: 1n, name: 'Alice', score: 1.5, active: true, count: 10 })
  })

  test('reads a middle slice with clamped bounds', async () => {
    const bytes = knownBytes()
    const { file } = await openParquet(bytes)
    const { rows } = await readWindow(bytes, file.metadata, ['id', 'name'], 2, 8)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toEqual({ id: 3n, name: null })
  })

  const corpusRow = async (name, rowEnd = 2) => {
    const bytes = await corpusBytes(name)
    const result = await openParquet(bytes)
    expect(result.status).toBe('ok')
    const { rows, failedColumns } = await readWindow(
      bytes,
      result.file.metadata,
      result.file.columns.map((column) => column.name),
      0,
      Math.min(rowEnd, result.file.rowCount)
    )
    return { file: result.file, rows, failedColumns, bytes }
  }

  test('every compression codec the viewer ships parses end to end', async () => {
    for (const name of [
      'alltypes_plain.parquet', // uncompressed
      'alltypes_plain.snappy.parquet', // snappy
      'byte_stream_split.zstd.parquet', // zstd
      'byte_stream_split_extended.gzip.parquet', // gzip
      'concatenated_gzip_members.parquet', // back-to-back gzip members
      'hadoop_lz4_compressed.parquet', // legacy hadoop-framed lz4
      'lz4_raw_compressed.parquet' // lz4_raw
    ]) {
      const { file, rows, failedColumns } = await corpusRow(name)
      expect(file.rowCount).toBeGreaterThan(0)
      expect(failedColumns).toEqual([])
      expect(rows.length).toBeGreaterThan(0)
      expect(Object.keys(rows[0]).length).toBe(file.columns.length)
    }
  })

  test('an int96 timestamp column arrives as a Date', async () => {
    const { rows } = await corpusRow('int96_from_spark.parquet')
    expect(rows[0].a instanceof Date).toBe(true)
    expect(displayValue(rows[0].a, { kind: 'timestamp' }).text).toBe('2024-01-01T20:34:56.123Z')
  })

  test('nested lists, maps and structs arrive as JSON-able values', async () => {
    const lists = await corpusRow('nested_lists.snappy.parquet')
    expect(Array.isArray(lists.rows[0].a)).toBe(true)
    const maps = await corpusRow('nested_maps.snappy.parquet')
    expect(maps.rows.length).toBeGreaterThan(0)
    const structs = await corpusRow('nested_structs.rust.parquet', 1)
    expect(typeof structs.rows[0].roll_num).toBe('object')
  })

  test('json columns arrive parsed', async () => {
    const { rows } = await corpusRow('json.parquet')
    expect(rows[0].json_field).toEqual({ a: 1 })
  })

  test('a bson column fails alone, without sinking the window', async () => {
    const { rows, failedColumns } = await corpusRow('bson.parquet', 3)
    expect(failedColumns).toHaveLength(1)
    expect(failedColumns[0].name).toBe('bson_field')
    expect(failedColumns[0].reason).toContain('bson')
    expect(rows).toHaveLength(3)
  })

  test('a brotli file fails column by column with the codec named', async () => {
    const { rows, failedColumns } = await corpusRow('large_string_map.brotli.parquet')
    expect(failedColumns.length).toBeGreaterThan(0)
    expect(failedColumns[0].reason).toContain('BROTLI')
    expect(rows.length).toBeGreaterThan(0)
  })

  test('dictionary, delta, decimal, v2-pages, float16, uuid and null-heavy files open', async () => {
    for (const name of [
      'alltypes_dictionary.parquet',
      'delta_binary_packed.parquet',
      'int32_decimal.parquet',
      'fixed_length_decimal.parquet',
      'datapage_v2.snappy.parquet',
      'float16_nonzeros_and_nans.parquet',
      'int32_with_uuid_logical_type.parquet',
      'nulls.snappy.parquet',
      'null_list.parquet',
      'old_list_structure.parquet',
      'single_nan.parquet',
      'int32_with_null_pages.parquet'
    ]) {
      const { file, failedColumns } = await corpusRow(name)
      expect(file.rowCount).toBeGreaterThan(0)
      expect(failedColumns).toEqual([])
    }
  })

  test('nulls render rather than throw', async () => {
    // The corpus's "nan" files carry their NaN in statistics, not data; the data row is null.
    const { rows, file } = await corpusRow('single_nan.parquet')
    const column = file.columns[0]
    expect(displayValue(rows[0][column.name], column).text).toBe('null')
  })
})

describe('typeLabel', () => {
  test('labels logical, converted and physical types', () => {
    expect(typeLabel({ type: 'BYTE_ARRAY', logical_type: { type: 'STRING' } })).toBe('string')
    expect(typeLabel({ type: 'INT64', logical_type: { type: 'TIMESTAMP', unit: 'MICROS' } })).toBe('timestamp[us]')
    expect(typeLabel({ type: 'INT32', converted_type: 'DATE' })).toBe('date')
    expect(typeLabel({ type: 'FIXED_LEN_BYTE_ARRAY', type_length: 16, logical_type: { type: 'UUID' } })).toBe('uuid')
    expect(typeLabel({ type: 'FIXED_LEN_BYTE_ARRAY', type_length: 2, logical_type: { type: 'FLOAT16' } })).toBe('float16')
    expect(typeLabel({ type: 'INT64', logical_type: { type: 'DECIMAL', precision: 18, scale: 3 } })).toBe('decimal(18,3)')
    expect(typeLabel({ type: 'INT96' })).toBe('timestamp[int96]')
    expect(typeLabel({ type: 'BYTE_ARRAY' })).toBe('binary')
    expect(typeLabel({ num_children: 2 })).toBe('group')
  })
})

describe('describeReadError', () => {
  test('names the codec or encoding hyparquet refused', () => {
    expect(describeReadError(new Error('parquet unsupported compression codec: BROTLI'))).toContain('BROTLI')
    expect(describeReadError(new Error('parquet unsupported encoding: ALP'))).toContain('ALP')
    expect(describeReadError(new Error('anything else'))).toBe('anything else')
    expect(describeReadError('a string error')).toBe('a string error')
  })
})
