// Builds ../editor/index.html: one self-contained file, because the editor frame's CSP allows only
// inline scripts and styles, with no network and no workers. Also writes ../THIRD_PARTY_NOTICES.txt
// from the packages that end up in the bundle, plus the vendored decompressors in src/vendored.
// Usage: bun install && bun build.mjs
import { build, transform } from 'esbuild'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const HERE = import.meta.dirname
const PLUGIN = path.resolve(HERE, '..')
const OUT = path.join(PLUGIN, 'editor', 'index.html')
const NOTICES = path.join(PLUGIN, 'THIRD_PARTY_NOTICES.txt')

const result = await build({
  entryPoints: [path.join(HERE, 'src', 'editor.js')],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  minify: true,
  legalComments: 'none',
  metafile: true,
  logLevel: 'warning',
  absWorkingDir: HERE
})
const css = (
  await transform(readFileSync(path.join(HERE, 'src', 'editor.css'), 'utf8'), { loader: 'css', minify: true })
).code.trim()

// Why: `<!--` then `<script` inside an inline script puts the HTML parser in a state where `</script>`
// no longer ends it. Every occurrence is inside a string or regex literal, where `\x3C` reads the same.
const js = result.outputFiles[0].text.replace(/<(!--|script)/gi, '\\x3C$1').trim()
new vm.Script(js)
if (/<\/script/i.test(js) || /<\/style/i.test(css)) {
  throw new Error('the bundle contains a closing script or style tag; it cannot be inlined')
}
if (/\beval\(|new Function\(/.test(js)) {
  throw new Error('the bundle contains eval or new Function; the frame CSP refuses both')
}

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Parquet</title>
<style>${css}</style>
</head>
<body>
<div class="app">
<div class="message" id="message" role="status"></div>
<div class="workbook" id="workbook" hidden>
<div class="notice" id="notice" role="note" hidden></div>
<div class="sheet-area">
<div class="grid-host" id="grid-host"></div>
<div class="sheet-message" id="sheet-message" hidden></div>
<div class="metadata" id="metadata" role="region" aria-label="Parquet metadata" hidden></div>
</div>
<div class="footer">
<div class="tabs" id="tabs" role="tablist" aria-label="Views">
<button class="tab" type="button" id="tab-data" role="tab" aria-selected="true" aria-controls="grid">Data</button>
<button class="tab" type="button" id="tab-metadata" role="tab" aria-selected="false" aria-controls="metadata">Metadata</button>
</div>
<div class="status"><span class="status-note" id="status-note"></span><span class="status-dims" id="status-dims"></span></div>
</div>
</div>
<div class="sr-only" id="live" aria-live="polite"></div>
</div>
<script>${js}</script>
</body>
</html>
`
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, html)

// --- Notices -------------------------------------------------------------------------------------

/** Vendored code in src/vendored, shipped inside the bundle without going through node_modules. */
const VENDORED = [
  {
    name: 'gzip.js + gzip.huffman.js (vendored in src/vendored)',
    version: 'hyparquet-compressors 1.1.2, adapted from fflate',
    license: 'MIT',
    homepage: 'https://github.com/hyparam/hyparquet-compressors',
    licenseFile: 'vendored-gzip.txt',
    note: 'GZip decompression that handles back-to-back gzip members, which the parquet spec permits. ' +
      'Adapted from fflate (Copyright (c) 2023 Arjun Barrett, MIT) via hyparquet-compressors (Copyright (c) 2024 Hyperparam, MIT).'
  },
  {
    name: 'lz4.js (vendored in src/vendored)',
    version: 'hyparquet-compressors 1.1.2',
    license: 'MIT',
    homepage: 'https://github.com/hyparam/hyparquet-compressors',
    licenseFile: 'vendored-lz4.txt',
    note: 'LZ4 and LZ4_RAW decompression with legacy hadoop framing, whose logic mirrors Apache Arrow ' +
      '(Apache License 2.0), via hyparquet-compressors (Copyright (c) 2024 Hyperparam, MIT).'
  }
]

// Every npm package with code in the bundle, with its licence as shipped in the package.
const packages = new Map()
for (const input of Object.keys(result.metafile.inputs)) {
  const at = input.lastIndexOf('node_modules/')
  if (at === -1) continue
  const name = /^(?:@[^/]+\/)?[^/]+/.exec(input.slice(at + 'node_modules/'.length))[0]
  const dir = path.join(HERE, input.slice(0, at), 'node_modules', name)
  packages.set(dir, { ...JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')), dir })
}
const licenceText = (pkg) => {
  const file = readdirSync(pkg.dir).find((entry) => /^(licen[cs]e|copying)(\.|$)/i.test(entry))
  if (!file) throw new Error(`${pkg.name} ships no licence file`)
  const text = readFileSync(path.join(pkg.dir, file), 'utf8').trim()
  // Why: build/licenses keeps the reviewed text in git; a dependency bump that changes it fails here.
  const reviewed = readFileSync(path.join(HERE, 'licenses', `${pkg.name.replace('/', '__')}.txt`), 'utf8').trim()
  if (text !== reviewed) throw new Error(`${pkg.name}'s licence differs from build/licenses; review and update it`)
  return text
}
const section = (title, version, license, homepage, text, note = '') =>
  `${title} ${version} (${license})\n${homepage}\n${note ? `${note}\n` : ''}\n${text}`

const sections = [...packages.values()]
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((pkg) => section(pkg.name, `@${pkg.version}`, pkg.license, pkg.homepage ?? '', licenceText(pkg)))
for (const vendored of VENDORED) {
  const reviewed = readFileSync(path.join(HERE, 'licenses', vendored.licenseFile), 'utf8').trim()
  sections.push(
    section(vendored.name, `@${vendored.version}`, vendored.license, vendored.homepage, reviewed, vendored.note)
  )
}
writeFileSync(
  NOTICES,
  `Parquet Viewer's editor/index.html bundles the following software.\n\n` +
    `${sections.join(`\n\n${'='.repeat(78)}\n\n`)}\n`
)

console.log(`editor/index.html: ${Buffer.byteLength(html)} bytes, ${packages.size} packages, ${VENDORED.length} vendored`)
