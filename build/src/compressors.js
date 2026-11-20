// Decompressors for every parquet compression codec this viewer can read, all pure JavaScript:
// no WebAssembly, so the editor runs in every Orca frame, desktop and web, under the frame CSP.
//
// hyparquet reads UNCOMPRESSED pages itself. It also ships a snappy decoder, but that one
// compiles a wasm module at import time (hysnappy), so we override SNAPPY with snappyjs here.
//
// BROTLI and LZO are refused with a clear message (messages.js); they are vanishingly rare in
// real parquet files, and the pure-JS brotli decoder is an order of magnitude larger than the
// rest of this bundle combined. GZIP handles back-to-back gzip members, which plain fflate
// refuses and the parquet spec permits.

import { uncompress as snappyUncompress } from 'snappyjs'
import { decompress as decompressZstd } from 'fzstd'
import { gunzip } from './vendored/gzip.js'
import { decompressLz4, decompressLz4Raw } from './vendored/lz4.js'

/** @type {import('hyparquet').Compressors} */
export const compressors = {
  SNAPPY: (input, length) => snappyUncompress(input, length),
  GZIP: (input, length) => gunzip(input, new Uint8Array(length)),
  ZSTD: (input) => decompressZstd(input),
  LZ4: decompressLz4,
  LZ4_RAW: decompressLz4Raw
}

/** Codecs this viewer cannot read yet, for error messages and the metadata view. */
export const unsupportedCodecs = ['BROTLI', 'LZO']
