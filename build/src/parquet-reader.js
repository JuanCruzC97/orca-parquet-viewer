// Reads parquet files with hyparquet: the footer once (openParquet), then row windows on
// demand as the grid scrolls (readWindow). The whole file is already an ArrayBuffer in the
// frame — Orca hands plugins the document bytes — so hyparquet slices it directly.
//
// Error paths a real file can hit, and what we do with them:
//   - not parquet / encrypted / truncated: detected from magic bytes before parsing (fileKind).
//   - a footer that does not thrift-decode: parquetMetadataAsync throws, shown as damaged.
//   - an unsupported codec (BROTLI, LZO) or encoding (BSON, INTERVAL values): the failing read
//     is retried column by column, so one exotic column cannot sink the whole grid.

import { parquetMetadataAsync, parquetReadObjects, parquetSchema } from 'hyparquet'
import { compressors, unsupportedCodecs } from './compressors.js'
import { MESSAGES } from './messages.js'

// "PAR1" and "PARE" (parquet modular encryption) as little-endian uint32.
const PAR1 = 0x31524150
const PARE = 0x45524150

/**
 * What a file's magic bytes say about it, before any parsing.
 *
 * @param {ArrayBuffer} bytes
 * @returns {'empty' | 'short' | 'encrypted' | 'notParquet' | 'truncated' | 'parquet'}
 */
export function fileKind(bytes) {
  if (bytes.byteLength === 0) return 'empty'
  if (bytes.byteLength < 12) return 'short'
  const view = new DataView(bytes)
  const head = view.getUint32(0, true)
  if (head === PARE) return 'encrypted'
  if (head !== PAR1) return 'notParquet'
  if (view.getUint32(bytes.byteLength - 4, true) !== PAR1) return 'truncated'
  return 'parquet'
}

/**
 * Opens a parquet file: footer, schema, columns and row-group facts.
 *
 * @param {ArrayBuffer} bytes the whole file, as Orca handed it to the editor
 * @returns {Promise<
 *   | { status: 'ok', file: object }
 *   | { status: 'empty' | 'short' | 'encrypted' | 'notParquet' | 'truncated' | 'noColumns' | 'damaged' }
 * >}
 */
export async function openParquet(bytes) {
  const kind = fileKind(bytes)
  if (kind !== 'parquet') return { status: kind }
  try {
    const metadata = await parquetMetadataAsync(bytes)
    const schemaTree = parquetSchema(metadata)
    const columns = schemaTree.children.map(toColumn)
    if (columns.length === 0) return { status: 'noColumns' }

    let firstRow = 0
    const rowGroups = metadata.row_groups.map((group, index) => {
      const codecs = new Set()
      let compressed = 0n
      let uncompressed = 0n
      for (const chunk of group.columns) {
        const meta = chunk.meta_data
        if (meta) {
          codecs.add(meta.codec)
          compressed += meta.total_compressed_size
          uncompressed += meta.total_uncompressed_size
        }
      }
      const entry = {
        index,
        firstRow,
        rowCount: Number(group.num_rows),
        compressed,
        uncompressed,
        codecs: [...codecs],
        chunks: group.columns
      }
      firstRow += entry.rowCount
      return entry
    })

    const allCodecs = new Set(rowGroups.flatMap((group) => group.codecs))
    const missing = [...allCodecs].filter((codec) => unsupportedCodecs.includes(codec))
    return {
      status: 'ok',
      file: {
        bytes,
        metadata,
        schemaTree,
        columns,
        rowCount: Number(metadata.num_rows),
        rowGroups,
        codecs: [...allCodecs],
        unsupportedCodecs: missing,
        keyValueMetadata: metadata.key_value_metadata ?? [],
        createdBy: metadata.created_by ?? '',
        version: metadata.version
      }
    }
  } catch {
    // The magic was fine but the footer did not decode: truncated metadata, corrupt thrift,
    // or a length field pointing outside the file.
    return { status: 'damaged' }
  }
}

/** Top-level column facts for the grid. Nested columns arrive as objects and arrays in rows. */
function toColumn(child, index) {
  const element = child.element
  return {
    index,
    name: element.name,
    label: typeLabel(element),
    kind: valueKind(element),
    tree: child
  }
}

const UNIT_SUFFIX = { MILLIS: 'ms', MICROS: 'us', NANOS: 'ns' }

/**
 * The column's type as a short label: `int64`, `string`, `timestamp[us]`, `decimal(18,3)`…
 *
 * @param {import('hyparquet').SchemaElement} element
 * @returns {string}
 */
export function typeLabel(element) {
  const logical = element.logical_type
  if (logical) {
    switch (logical.type) {
      case 'STRING': return 'string'
      case 'DECIMAL': return `decimal(${logical.precision},${logical.scale})`
      case 'DATE': return 'date'
      case 'TIME': return `time[${UNIT_SUFFIX[logical.unit]}]`
      case 'TIMESTAMP': return `timestamp[${UNIT_SUFFIX[logical.unit]}]`
      case 'INTEGER': return `${logical.isSigned ? 'int' : 'uint'}${logical.bitWidth}`
      case 'UUID': return 'uuid'
      case 'JSON': return 'json'
      case 'BSON': return 'bson'
      case 'LIST': return 'list'
      case 'MAP': return 'map'
      case 'ENUM': return 'enum'
      case 'FLOAT16': return 'float16'
      case 'GEOMETRY': return 'geometry'
      case 'GEOGRAPHY': return 'geography'
      case 'VARIANT': return 'variant'
      case 'INTERVAL': return 'interval'
      case 'NULL': return 'null'
      case 'FILE': return 'file'
    }
  }
  switch (element.converted_type) {
    case 'UTF8': return 'string'
    case 'DECIMAL': return `decimal(${element.precision ?? ''},${element.scale ?? 0})`
    case 'DATE': return 'date'
    case 'TIME_MILLIS': return 'time[ms]'
    case 'TIME_MICROS': return 'time[us]'
    case 'TIMESTAMP_MILLIS': return 'timestamp[ms]'
    case 'TIMESTAMP_MICROS': return 'timestamp[us]'
    case 'UINT_8': return 'uint8'
    case 'UINT_16': return 'uint16'
    case 'UINT_32': return 'uint32'
    case 'UINT_64': return 'uint64'
    case 'INT_8': return 'int8'
    case 'INT_16': return 'int16'
    case 'INT_32': return 'int32'
    case 'INT_64': return 'int64'
    case 'ENUM': return 'enum'
    case 'JSON': return 'json'
    case 'BSON': return 'bson'
    case 'MAP': return 'map'
    case 'MAP_KEY_VALUE': return 'map'
    case 'LIST': return 'list'
    case 'INTERVAL': return 'interval'
  }
  switch (element.type) {
    case 'BOOLEAN': return 'boolean'
    case 'INT32': return 'int32'
    case 'INT64': return 'int64'
    // Every reader treats unannotated INT96 as a legacy timestamp, as does hyparquet.
    case 'INT96': return 'timestamp[int96]'
    case 'FLOAT': return 'float'
    case 'DOUBLE': return 'double'
    case 'BYTE_ARRAY': return 'binary'
    case 'FIXED_LEN_BYTE_ARRAY': return `fixed(${element.type_length ?? '?'})`
  }
  return 'group'
}

/**
 * How displayValue formats this column's values. Only dates and timestamps differ.
 *
 * @param {import('hyparquet').SchemaElement} element
 * @returns {'date' | 'timestamp' | null}
 */
function valueKind(element) {
  if (element.logical_type) {
    if (element.logical_type.type === 'DATE') return 'date'
    if (element.logical_type.type === 'TIMESTAMP') return 'timestamp'
  }
  switch (element.converted_type) {
    case 'DATE': return 'date'
    case 'TIMESTAMP_MILLIS':
    case 'TIMESTAMP_MICROS': return 'timestamp'
  }
  if (element.type === 'INT96') return 'timestamp'
  return null
}

/**
 * Reads a row window. All `columns` at once; hyparquet touches only the row groups (and, when
 * the file carries offset indexes, only the pages) that overlap the range.
 *
 * @param {ArrayBuffer} bytes
 * @param {import('hyparquet').FileMetaData} metadata parsed once by openParquet
 * @param {string[] | undefined} names column names, or undefined for all
 * @param {number} rowStart first row, inclusive
 * @param {number} rowEnd last row, exclusive
 * @returns {Promise<object[]>} rows as objects keyed by column name
 */
function readRows(bytes, metadata, names, rowStart, rowEnd) {
  return parquetReadObjects({
    file: bytes,
    metadata,
    columns: names,
    rowStart,
    rowEnd,
    compressors,
    useOffsetIndex: true
  })
}

/**
 * Reads one grid window. If a single column defeats the whole-file read (an unsupported
 * encoding, a BSON column, damaged pages), the columns are read one by one so the rest of the
 * row still shows; failed columns come back in `failedColumns`.
 *
 * @returns {Promise<{ rows: object[], failedColumns: { name: string, reason: string }[] }>}
 */
export async function readWindow(bytes, metadata, names, rowStart, rowEnd) {
  try {
    return { rows: await readRows(bytes, metadata, names, rowStart, rowEnd), failedColumns: [] }
  } catch (error) {
    const reason = describeReadError(error)
    const settled = await Promise.allSettled(
      names.map((name) => readRows(bytes, metadata, [name], rowStart, rowEnd))
    )
    const rows = []
    const failedColumns = []
    const width = rowEnd - rowStart
    for (let index = 0; index < names.length; index++) {
      const outcome = settled[index]
      if (outcome.status !== 'fulfilled') {
        failedColumns.push({ name: names[index], reason: describeReadError(outcome.reason) })
        continue
      }
      const columnRows = outcome.value
      for (let r = 0; r < Math.min(width, columnRows.length); r++) {
        const value = columnRows[r][names[index]]
        if (rows[r] === undefined) rows[r] = {}
        rows[r][names[index]] = value
      }
    }
    while (rows.length < width) rows.push({})
    return { rows, failedColumns }
  }
}

/** Turns a hyparquet read error into a person-readable reason, with the codec or encoding named. */
export function describeReadError(error) {
  const message = error instanceof Error ? error.message : String(error)
  const codec = /unsupported compression codec: (\w+)/.exec(message)
  if (codec) return MESSAGES.unsupportedCodec(codec[1])
  const encoding = /unsupported encoding: (\w+)/.exec(message)
  if (encoding) return MESSAGES.unsupportedEncoding(encoding[1])
  return message || MESSAGES.readFailed
}
