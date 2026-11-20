# AGENTS.md — working on Parquet Viewer

Read-only Apache Parquet viewer for Orca (`sandboxed-ui`, custom editor, `contentKind: bytes`),
published as the community plugin `juancruzc97.parquet-viewer` from this repository. It opens
`.parquet`, `.parq`, `.pq` and `.pqt` files in an Orca editor tab.

## Map

| Path | What it is |
| --- | --- |
| `orca-plugin.json` | The manifest Orca loads. The version lives here. |
| `editor/index.html` | **Generated.** Never edit it by hand; rebuild it. |
| `build/src/` | The editor's source: plain DOM, no framework. |
| `build/build.mjs` | esbuild → one self-contained `editor/index.html` with everything inlined (the editor frame's CSP allows only inline scripts and styles, no network, no workers). Also rewrites `THIRD_PARTY_NOTICES.txt` and fails if a dependency's licence differs from `build/licenses/`. |
| `build/src/vendored/` | The gzip (fflate-derived, handles back-to-back members) and lz4 (hadoop-framed) decompressors, vendored from hyparquet-compressors (MIT). |
| `build/test/`, `build/scripts/` | bun tests; fixture generators and the apache/parquet-testing corpus fetcher. |
| `images/` | The catalog cover and screenshots. |

## Workflow

1. Change `build/src/**`.
2. Rebuild: `cd build && bun build.mjs`. The rebuilt `editor/index.html` belongs in the same
   commit as its source. The build is deterministic — the same lockfile always produces the same
   bytes, so a clean `git status` after rebuilding means the editor is synced.
3. `bun test` — every test must pass. New behavior gets a test. Tests assert against the real
   corpus (apache/parquet-testing; auto-downloads to `$PARQUET_FIXTURES`, default
   `/tmp/opencode/parquet-fixtures`) and against the generated `known.parquet` fixture, whose
   values live in `scripts/make-fixture.mjs`.
4. Live check against Orca (dev plugin loaded from this folder):
   `orca plugin shot . --editor <fixture>.parquet --json` — require `settled: true` and
   `errors: []`, then eyeball the PNG. Frame errors also land in
   `orca plugin logs local.parquet-viewer`. `--act` needs Orca's window hidden or minimized.
5. `orca plugin validate .` — must exit 0.

The dev plugin is `local.parquet-viewer` (`orca plugin dev watch .` reloads on save). Plain code
edits run without asking again; raising the execution profile or adding capabilities needs a new
`--approve <fingerprint>`, which Orca prints.

## Hard constraints

- **No WebAssembly, no `eval`/`new Function`, no network, no workers** in the editor: the
  frame's CSP refuses them, and the build fails on `eval`/`new Function`. Everything ships
  inline in `editor/index.html` (entry ≤ 10 MiB, plugin folder ≤ 50 MiB, ≤ 2,000 files).
- **Compression codecs stay pure JavaScript**: snappyjs, the vendored gzip and lz4, and fzstd for
  zstd. BROTLI and LZO are refused with a clear message; adding one means vendoring a pure-JS
  decoder, never wasm.
- **No symlinks and no binaries anywhere in the repo**: the directory's safety checks reject
  them, and the repo root is the plugin folder. PNG images are fine; TTF and OTF fonts are not.
  (This is why `CLAUDE.md` is an `@AGENTS.md` import rather than a symlink.)
- **The viewer stays read-only.** Orca saves an editor's file by replacing it whole, and parquet
  is columnar — a "small edit" is a whole-file rewrite. Same call the official sqlite-browser
  makes.
- **Licences:** a new bundled npm dependency needs its licence text committed to
  `build/licenses/<pkg>.txt`; vendored code keeps its copyright header. The build compares both
  on every run.
- **User-facing copy** goes through `build/src/messages.js`, in Orca's tone: plain, short, says
  what to do next.

## Publishing a version

1. Bump `version` in `orca-plugin.json`.
2. Commit (conventional: `feat:`, `fix:`, `docs:`, `chore:`) with source and the rebuilt editor
   together, and push to `main`.
3. `git tag vX.Y.Z && git push origin vX.Y.Z` — the directory lists the newest `vX.Y.Z` tag
   only; pushes without a new tag change nothing. The tag pins the exact commit and content hash,
   so ship the build you validated.
4. Watch the status page:
   <https://orca.dev/plugins/JuanCruzC97/orca-parquet-viewer> — if the validator objects, it
   says exactly what to fix. Updates that ask for no new access install for users without
   asking again.

The listing policy (free to install and use, no paywalls, no impersonation, ids may not start
with `orca`) is `docs/reference/plugin-listing-policy.md` in `stablyai/orca`.
