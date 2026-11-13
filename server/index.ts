// App server: JSON API under /api, plus the built web app from dist/ (npm start).
import { readFile } from 'node:fs/promises'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { config, emailCodesEnabled, googleEnabled } from './config.ts'
import { migrate, sql } from './db.ts'
import { csrfGuard, loadSession, type AppEnv } from './lib/session.ts'
import { auth } from './routes/auth.ts'
import { places } from './routes/places.ts'

const app = new Hono<AppEnv>()

app.use('*', async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.header('X-Frame-Options', 'DENY')
})

app.get('/api/health', async (c) => {
  await sql`SELECT 1`
  return c.json({ ok: true })
})
app.use('/api/*', csrfGuard, loadSession)
app.use('/api/*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'no-store')
})
app.route('/api/auth', auth)
app.route('/api/places', places)
app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))

app.onError((err, c) => {
  console.error('[api] error', err)
  return c.json({ error: 'Something went wrong. Please try again.' }, 500)
})

// Built web app. Hashed assets are cached for a year; everything else revalidates.
app.use(
  '*',
  serveStatic({
    root: './dist',
    onFound: (path, c) => {
      c.header('Cache-Control', path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
    },
  }),
)
let indexHtml: string | null = null
app.get('*', async (c) => {
  try {
    indexHtml ??= await readFile(new URL('../dist/index.html', import.meta.url), 'utf8')
  } catch {
    return c.text('Web app not built. Run `npm run build`, or use `npm run dev` for development.', 404)
  }
  c.header('Cache-Control', 'no-cache')
  return c.html(indexHtml)
})

await migrate()
serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
  console.log(`[server] listening on :${info.port} (${config.appUrl})`)
  console.log(`[server] sign-in: password, QR${emailCodesEnabled() ? ', email code' : ''}${googleEnabled() ? ', Google' : ''}`)
})
