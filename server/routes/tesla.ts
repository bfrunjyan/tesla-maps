import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { config, teslaEnabled } from '../config.ts'
import { randomToken } from '../lib/crypto.ts'
import { clientIp, hit, tooMany } from '../lib/rateLimit.ts'
import { requireUser, type AppEnv } from '../lib/session.ts'
import { TESLA_SCOPES, chooseTeslaCar, connectTesla, readTesla, teslaRedirectUri, teslaStatus, unlinkTesla } from '../lib/tesla.ts'

/** Connect Tesla: link a Tesla account, then read the battery from the driver's car. */
export const tesla = new Hono<AppEnv>()

const STATE_COOKIE = 'cn_tesla'
const COOKIE_PATH = '/api/tesla'
/** Where the app shows the outcome: /?tesla=connected | cancelled | nocar | failed | signin. */
const back = (outcome: string) => `/?tesla=${outcome}`

tesla.get('/status', async (c) => {
  const user = c.get('user')
  const enabled = teslaEnabled()
  if (!enabled || !user) return c.json({ enabled, connected: false, cars: [], vin: null, reading: null })
  return c.json({ enabled, ...(await teslaStatus(user.id)) })
})

/** Sends the driver to Tesla's sign-in page. Opened as a normal page, not by fetch. */
tesla.get('/start', (c) => {
  if (!teslaEnabled()) return c.text('Connect Tesla is not set up.', 503)
  const user = c.get('user')
  if (!user) return c.redirect(back('signin'))
  const state = randomToken(24)
  setCookie(c, STATE_COOKIE, JSON.stringify({ state, uid: user.id }), {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'Lax',
    path: COOKIE_PATH,
    maxAge: 600,
  })
  const url = new URL(config.tesla.authUrl)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.tesla.clientId,
    redirect_uri: teslaRedirectUri(),
    scope: TESLA_SCOPES,
    state,
    locale: 'en-US',
    prompt_missing_scopes: 'true',
    require_requested_scopes: 'true',
  }).toString()
  return c.redirect(url.toString())
})

tesla.get('/callback', async (c) => {
  let saved: { state?: string; uid?: string } | null = null
  try {
    saved = JSON.parse(getCookie(c, STATE_COOKIE) ?? 'null')
  } catch {
    saved = null
  }
  deleteCookie(c, STATE_COOKIE, { path: COOKIE_PATH, secure: config.secureCookies })
  if (!teslaEnabled()) return c.redirect(back('failed'))
  const user = c.get('user')
  if (!user) return c.redirect(back('signin'))
  const code = c.req.query('code')
  // The answer must belong to the sign-in this same driver started here.
  if (!saved?.state || saved.uid !== user.id || c.req.query('state') !== saved.state) return c.redirect(back('failed'))
  if (!code) return c.redirect(back('cancelled'))
  if (!hit(`tesla-connect:${user.id}`, 10, 60 * 60_000)) return c.redirect(back('failed'))
  return c.redirect(back(await connectTesla(user.id, code)))
})

/** Asks the car for its battery now. Returns the stored reading when asked again within a minute. */
tesla.post('/read', requireUser, async (c) => {
  if (!teslaEnabled()) return c.json({ error: 'Connect Tesla is not set up.' }, 503)
  if (!hit(`tesla-read:${c.get('user')!.id}:${clientIp(c)}`, 30, 60_000)) return tooMany(c)
  const { status, note } = await readTesla(c.get('user')!.id)
  return c.json({ enabled: true, ...status, note })
})

/** Which of the account's cars to read. */
tesla.put('/car', requireUser, async (c) => {
  const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>
  const status = typeof b.vin === 'string' ? await chooseTeslaCar(c.get('user')!.id, b.vin) : null
  if (!status) return c.json({ error: 'That car is not on your Tesla account.' }, 400)
  return c.json({ enabled: teslaEnabled(), ...status })
})

/** Disconnect: Mapic forgets the Tesla account and its tokens. */
tesla.delete('/', requireUser, async (c) => {
  await unlinkTesla(c.get('user')!.id)
  return c.json({ ok: true })
})
