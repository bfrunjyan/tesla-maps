// Minimal static server for the production build (used by `npm start` on Railway).
// No dependencies: serves dist/, long-caches hashed assets, falls back to index.html.
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('./dist/', import.meta.url))
const PORT = Number(process.env.PORT) || 3000

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
}

async function resolveFile(urlPath) {
  let rel
  try {
    rel = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^([/\\])+/, '')
  } catch {
    return null
  }
  const file = join(ROOT, rel)
  if (!file.startsWith(ROOT) && file + sep !== ROOT) return null // path traversal
  try {
    const s = await stat(file)
    if (s.isFile()) return { file, size: s.size }
  } catch {
    /* fall through */
  }
  return null
}

createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end()
    return
  }
  const found = (await resolveFile(req.url ?? '/')) ?? (await resolveFile('/index.html'))
  if (!found) {
    res.writeHead(404).end('Not found')
    return
  }
  const isAsset = found.file.includes(`${sep}assets${sep}`)
  res.writeHead(200, {
    'Content-Type': TYPES[extname(found.file)] ?? 'application/octet-stream',
    'Content-Length': found.size,
    'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  })
  if (req.method === 'HEAD') return res.end()
  createReadStream(found.file).pipe(res)
}).listen(PORT, '0.0.0.0', () => console.log(`Serving dist/ on port ${PORT}`))
