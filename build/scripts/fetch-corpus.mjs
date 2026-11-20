// Downloads the apache/parquet-testing files the tests use (and that make good development
// fixtures) into $PARQUET_FIXTURES/corpus, once; later runs reuse what is already there.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const FIXTURES_DIR = process.env.PARQUET_FIXTURES ?? '/tmp/opencode/parquet-fixtures'

/** A curated slice of apache/parquet-testing/data: codecs, nestings, encodings, oddities. */
export const CORPUS_FILES = [
  'alltypes_plain.parquet',
  'alltypes_plain.snappy.parquet',
  'alltypes_dictionary.parquet',
  'byte_stream_split.zstd.parquet',
  'byte_stream_split_extended.gzip.parquet',
  'concatenated_gzip_members.parquet',
  'hadoop_lz4_compressed.parquet',
  'lz4_raw_compressed.parquet',
  'large_string_map.brotli.parquet',
  'nested_lists.snappy.parquet',
  'nested_maps.snappy.parquet',
  'nested_structs.rust.parquet',
  'int96_from_spark.parquet',
  'float16_nonzeros_and_nans.parquet',
  'nulls.snappy.parquet',
  'datapage_v2.snappy.parquet',
  'delta_binary_packed.parquet',
  'fixed_length_decimal.parquet',
  'int32_decimal.parquet',
  'empty_data_pages_v1.parquet',
  'bson.parquet',
  'json.parquet',
  'int32_with_uuid_logical_type.parquet',
  'uniform_encryption.parquet.encrypted',
  'single_nan.parquet',
  'int32_with_null_pages.parquet',
  'null_list.parquet',
  'old_list_structure.parquet'
]

const SOURCE = 'https://raw.githubusercontent.com/apache/parquet-testing/master/data'

/** Returns the local path of a corpus file, downloading it once if needed. */
export async function corpusFile(name) {
  const file = path.join(FIXTURES_DIR, 'corpus', name)
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true })
    const response = await fetch(`${SOURCE}/${name}`)
    if (!response.ok) throw new Error(`could not download ${name}: ${response.status}`)
    writeFileSync(file, Buffer.from(await response.arrayBuffer()))
  }
  return file
}

/** The bytes of a corpus file, ready for openParquet. */
export async function corpusBytes(name) {
  const file = await corpusFile(name)
  const buffer = readFileSync(file)
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}

if (import.meta.main) {
  for (const name of CORPUS_FILES) {
    await corpusFile(name)
    console.log(name)
  }
}
