# Building Parquet Viewer

`../editor/index.html` is generated. Orca loads it as one document inside a sandboxed frame whose
CSP allows only inline scripts and styles and no workers, so the build inlines everything into
that one file. There is no framework: the grid is plain DOM.

```sh
bun install
bun build.mjs
bun test
```

The build is deterministic: the same lockfile produces the same bytes. It also rewrites
`../THIRD_PARTY_NOTICES.txt` from the packages in the bundle and the vendored decompressors, and
fails if a package's licence differs from the reviewed copy in `licenses/`.

Any runtime with esbuild works; `bun` is what this repo develops with.

## Reading parquet

hyparquet parses the file: the footer once, then only the row groups (and, when the file carries
offset indexes, only the pages) that overlap the rows on screen. The editor asks for windows of
rows as the grid scrolls — 2,000 by default, larger when the file's row groups are large, since
a window smaller than its row group would re-decompress that group on every read — and keeps at
most eight windows warm, evicting the ones farthest from view. Wide files (more than 40 columns)
read only the columns on screen.

Every compression codec is decoded in pure JavaScript, no WebAssembly, so the editor runs in
every Orca client under the frame CSP:

| Codec | Decoder | Where |
| --- | --- | --- |
| UNCOMPRESSED | — | hyparquet |
| SNAPPY | [snappyjs](https://github.com/zhipeng-jia/snappyjs) | npm |
| GZIP | vendored `src/vendored/gzip.js` | fflate-derived, handles back-to-back gzip members |
| ZSTD | [fzstd](https://github.com/101arrowz/fzstd) | npm |
| LZ4, LZ4_RAW | vendored `src/vendored/lz4.js` | hadoop framing per Apache Arrow |

hyparquet's own snappy decoder is overridden because it compiles a wasm module at import time.
The vendored files come from
[hyparquet-compressors](https://github.com/hyparam/hyparquet-compressors) (MIT), whose gzip.js
is adapted from [fflate](https://github.com/101arrowz/fflate) (MIT) and whose lz4 framing mirrors
Apache Arrow (Apache-2.0); their licence texts are reviewed copies in `licenses/`.

BROTLI and LZO are refused with a clear message: the pure-JS brotli decoder is larger than the
rest of this bundle combined, and real-world brotli or lzo parquet files are vanishingly rare.

## Talking to Orca

`orca.document.session({ decode })` does the document sync: decode only wraps the bytes Orca
hands over, the viewer never edits, so there is no `encode`, no `merge`, and the tab is never
dirty. Outside file changes re-decode; read-only tabs need nothing special.

## Source layout

| File | What it holds |
| --- | --- |
| `src/editor.js` | Entry: the document session, view tabs, row-window cache, status bar |
| `src/parquet-reader.js` | Footer, schema, row-group facts; row-window reads; error classification |
| `src/compressors.js` | The pure-JS codec map handed to hyparquet |
| `src/grid-view.js` | The virtualized grid: rendering, scrolling, keyboard input |
| `src/metadata-view.js` | The Metadata tab: file facts, schema tree, row groups, key-value metadata |
| `src/cell-display.js` | Value → grid text and kind, capped for the DOM |
| `src/messages.js` | Every message the editor can show |
| `src/axis.js` | Prefix sums + binary search for one grid axis |
| `src/vendored/` | The gzip and lz4 decompressors described above |
| `scripts/fetch-corpus.mjs` | Downloads the apache/parquet-testing files the tests use |
| `scripts/make-fixture.mjs` | Generates `known.parquet`, the exact-value fixture |
| `scripts/make-dev-fixtures.mjs` | Generates a 200k-row file and a 60-column file for scale |
| `scripts/make-demo-fixture.mjs` | Generates the demo dataset used in the screenshots |

## Tests

`bun test` covers the reader against the generated fixture's exact values and against
[apache/parquet-testing](https://github.com/apache/parquet-testing) files: every codec, nested
lists/maps/structs, int96, decimals, delta encodings, dictionary and v2 pages, float16, uuid, and
the failure paths — brotli, bson, corrupt footers, encrypted files. Corpus files download once
into `$PARQUET_FIXTURES` (default `/tmp/opencode/parquet-fixtures`). `test/metadata-view.test.mjs`
renders the metadata panel against a DOM from happy-dom.

The editor itself is exercised with Orca's CLI against the built file:

```sh
orca plugin validate .. && orca plugin shot .. --editor <file>.parquet --json
```

`settled` and an empty `errors` list mean the frame asked for its document and painted without
console errors; the PNG is there to eyeball.
