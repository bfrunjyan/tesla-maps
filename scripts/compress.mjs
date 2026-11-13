// After `vite build`: write Brotli (.br) and gzip (.gz) copies of text assets in dist/.
// The server sends these to browsers that accept them (serveStatic precompressed).
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

const DIST = new URL('../dist/', import.meta.url).pathname
const TEXT = /\.(js|mjs|css|html|svg|json|txt|map)$/

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(p)
    else yield p
  }
}

let raw = 0, br = 0, gz = 0, files = 0
for await (const file of walk(DIST)) {
  if (!TEXT.test(file) || (await stat(file)).size < 1024) continue
  const data = await readFile(file)
  const b = brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } })
  const g = gzipSync(data, { level: 9 })
  await writeFile(`${file}.br`, b)
  await writeFile(`${file}.gz`, g)
  raw += data.length; br += b.length; gz += g.length; files++
}
const kb = (n) => `${(n / 1024).toFixed(0)} KB`
console.log(`[compress] ${files} files: ${kb(raw)} → brotli ${kb(br)}, gzip ${kb(gz)}`)
