// The app: JSON API under /api, plus the built web app from dist/.
// Kept free of side effects (no listening, no migrations) so tests can call it directly.
import { readFile } from 'node:fs/promises'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { config } from './config.ts'
import { sql } from './db.ts'
import { signInCodeEmail } from './lib/emailTemplates.ts'
import { csrfGuard, loadSession, type AppEnv } from './lib/session.ts'
import { auth } from './routes/auth.ts'
import { chargers } from './routes/chargers.ts'
import { vehicle } from './routes/vehicle.ts'
import { places } from './routes/places.ts'

export const app = new Hono<AppEnv>()

// One canonical address: requests to any other host (e.g. the old *.railway.app URL)
// redirect to APP_URL, so cookies, CSRF checks and QR links all use the same origin.
// The health check stays reachable on any host for the platform's probes.
const canonicalHost = new URL(config.appUrl).host
app.use('*', async (c, next) => {
  const host = c.req.header('x-forwarded-host') ?? c.req.header('host') ?? ''
  if (config.production && host && host !== canonicalHost && c.req.path !== '/api/health') {
    const url = new URL(c.req.url)
    return c.redirect(`${config.appUrl}${url.pathname}${url.search}`, 308)
  }
  await next()
})

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
// Development only: preview email templates in the browser.
if (!config.production) {
  app.get('/api/dev/email/sign-in', (c) => c.html(signInCodeEmail('482917').html))
}
app.route('/api/auth', auth)
app.route('/api/places', places)
app.route('/api/chargers', chargers)
app.route('/api/vehicle', vehicle)
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
    // Sends dist/*.br or *.gz (made at build time) when the browser accepts them.
    precompressed: true,
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
