import { createHash } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { config, emailCodesEnabled, googleEnabled } from '../config.ts'
import { sql } from '../db.ts'
import { dummyPasswordHash, hashPassword, numericCode, pairingCode, randomToken, safeEqualHex, sha256, verifyPassword } from '../lib/crypto.ts'
import { sendSignInCode } from '../lib/email.ts'
import { clientIp, hit, tooMany } from '../lib/rateLimit.ts'
import { endSession, requireUser, startSession, type AppEnv, type SessionUser } from '../lib/session.ts'

export const auth = new Hono<AppEnv>()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN = 60_000

function normEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const e = v.trim().toLowerCase()
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null
}

async function body(c: Context): Promise<Record<string, unknown>> {
  try {
    const b = await c.req.json()
    return b && typeof b === 'object' ? (b as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

async function publicUser(userId: string): Promise<SessionUser> {
  const [u] = await sql<SessionUser[]>`
    SELECT id, email, name, email_verified AS "emailVerified", (password_hash IS NOT NULL) AS "hasPassword"
    FROM users WHERE id = ${userId}`
  return u
}

/**
 * Sign-in that proves ownership of the email (code or Google). If the account was
 * created with an unverified password, someone else may have registered it first:
 * drop that password and their sessions so they can't keep access.
 */
async function verifiedSignIn(email: string, extra: { googleSub?: string; name?: string | null } = {}) {
  return sql.begin(async (tx) => {
    const [existing] = await tx<{ id: string; email_verified: boolean }[]>`
      SELECT id, email_verified FROM users WHERE email = ${email} FOR UPDATE`
    if (!existing) {
      const [created] = await tx<{ id: string }[]>`
        INSERT INTO users (email, email_verified, google_sub, name)
        VALUES (${email}, true, ${extra.googleSub ?? null}, ${extra.name ?? null}) RETURNING id`
      return created.id
    }
    if (!existing.email_verified) {
      await tx`UPDATE users SET email_verified = true, password_hash = NULL WHERE id = ${existing.id}`
      await tx`DELETE FROM sessions WHERE user_id = ${existing.id}`
    }
    if (extra.googleSub) {
      await tx`UPDATE users SET google_sub = ${extra.googleSub}, name = COALESCE(name, ${extra.name ?? null}) WHERE id = ${existing.id}`
    }
    return existing.id
  })
}

/* ------------------------------------------------------------ discovery */

auth.get('/config', (c) =>
  c.json({ methods: { qr: true, emailCode: emailCodesEnabled(), password: true, google: googleEnabled() } }),
)

auth.get('/me', (c) => c.json({ user: c.get('user') }))

auth.post('/logout', async (c) => {
  await endSession(c)
  return c.json({ ok: true })
})

auth.delete('/me', requireUser, async (c) => {
  await sql`DELETE FROM users WHERE id = ${c.get('user')!.id}`
  await endSession(c)
  return c.json({ ok: true })
})

/* ---------------------------------------------------- email + password */

auth.post('/register', async (c) => {
  if (!hit(`register:${clientIp(c)}`, 10, 60 * MIN)) return tooMany(c)
  const b = await body(c)
  const email = normEmail(b.email)
  const password = typeof b.password === 'string' ? b.password : ''
  if (!email) return c.json({ error: 'Enter a valid email address.' }, 400)
  if (password.length < 8) return c.json({ error: 'Use at least 8 characters for the password.' }, 400)
  if (password.length > 128) return c.json({ error: 'That password is too long.' }, 400)
  const [exists] = await sql`SELECT 1 FROM users WHERE email = ${email}`
  if (exists) return c.json({ error: 'An account with this email already exists. Sign in instead.' }, 409)
  const hash = await hashPassword(password)
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash) VALUES (${email}, ${hash})
    ON CONFLICT (email) DO NOTHING RETURNING id`
  if (!user) return c.json({ error: 'An account with this email already exists. Sign in instead.' }, 409)
  await startSession(c, user.id)
  return c.json({ user: await publicUser(user.id) })
})

auth.post('/login', async (c) => {
  const b = await body(c)
  const email = normEmail(b.email)
  const password = typeof b.password === 'string' ? b.password.slice(0, 256) : ''
  if (!hit(`login-ip:${clientIp(c)}`, 30, 15 * MIN) || (email && !hit(`login:${email}`, 10, 15 * MIN))) return tooMany(c)
  const [user] = email
    ? await sql<{ id: string; password_hash: string | null }[]>`SELECT id, password_hash FROM users WHERE email = ${email}`
    : []
  let ok = false
  if (user?.password_hash) ok = await verifyPassword(password, user.password_hash)
  else await verifyPassword(password, await dummyPasswordHash()) // same timing when the account doesn't exist
  if (!user || !ok) return c.json({ error: 'Email or password is incorrect.' }, 401)
  await startSession(c, user.id)
  return c.json({ user: await publicUser(user.id) })
})

/* ------------------------------------------------------ email one-time code */

auth.post('/email/start', async (c) => {
  if (!emailCodesEnabled()) return c.json({ error: 'Email codes are not available.' }, 503)
  const email = normEmail((await body(c)).email)
  if (!email) return c.json({ error: 'Enter a valid email address.' }, 400)
  if (!hit(`code-ip:${clientIp(c)}`, 20, 60 * MIN) || !hit(`code:${email}`, 5, 15 * MIN)) return tooMany(c)
  const code = numericCode()
  await sql`UPDATE email_codes SET consumed_at = now() WHERE email = ${email} AND consumed_at IS NULL`
  await sql`
    INSERT INTO email_codes (email, code_hash, expires_at)
    VALUES (${email}, ${sha256(`${email}:${code}`)}, now() + interval '10 minutes')`
  try {
    await sendSignInCode(email, code)
  } catch (err) {
    console.error('[email] send failed', err)
    return c.json({ error: 'Couldn’t send the email. Try again in a moment.' }, 502)
  }
  return c.json({ ok: true })
})

auth.post('/email/verify', async (c) => {
  const b = await body(c)
  const email = normEmail(b.email)
  const code = typeof b.code === 'string' ? b.code.replace(/\D/g, '') : ''
  if (!email || code.length !== 6) return c.json({ error: 'Enter the 6-digit code from the email.' }, 400)
  if (!hit(`verify:${email}`, 10, 15 * MIN)) return tooMany(c)
  const [row] = await sql<{ id: string; code_hash: string; attempts: number }[]>`
    UPDATE email_codes SET attempts = attempts + 1
    WHERE id = (SELECT id FROM email_codes WHERE email = ${email} AND consumed_at IS NULL AND expires_at > now()
                ORDER BY created_at DESC LIMIT 1)
    RETURNING id, code_hash, attempts`
  if (!row || row.attempts > 5) return c.json({ error: 'That code has expired. Request a new one.' }, 400)
  if (!safeEqualHex(row.code_hash, sha256(`${email}:${code}`))) return c.json({ error: 'That code isn’t right. Check the email and try again.' }, 400)
  await sql`UPDATE email_codes SET consumed_at = now() WHERE id = ${row.id}`
  const userId = await verifiedSignIn(email)
  await startSession(c, userId)
  return c.json({ user: await publicUser(userId) })
})

/* ------------------------------------------------------------ Google */

const OAUTH_COOKIE = 'cn_oauth'
const redirectUri = () => `${config.appUrl}/api/auth/google/callback`
const safeReturn = (v: string | undefined) => (v && v.startsWith('/') && !v.startsWith('//') ? v : '/')

auth.get('/google/start', (c) => {
  if (!googleEnabled()) return c.text('Google sign-in is not configured.', 503)
  const state = randomToken(24)
  const verifier = randomToken(48)
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  setCookie(c, OAUTH_COOKIE, JSON.stringify({ state, verifier, ret: safeReturn(c.req.query('return')) }), {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'Lax',
    path: '/api/auth/google',
    maxAge: 600,
  })
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString()
  return c.redirect(url.toString())
})

auth.get('/google/callback', async (c) => {
  let saved: { state: string; verifier: string; ret: string } | null = null
  try {
    saved = JSON.parse(getCookie(c, OAUTH_COOKIE) ?? 'null')
  } catch {
    saved = null
  }
  deleteCookie(c, OAUTH_COOKIE, { path: '/api/auth/google', secure: config.secureCookies })
  const fail = (reason: string) => c.redirect(`${saved?.ret ?? '/'}${(saved?.ret ?? '/').includes('?') ? '&' : '?'}auth_error=${encodeURIComponent(reason)}`)
  const code = c.req.query('code')
  if (!saved || !code || c.req.query('state') !== saved.state) return fail('Google sign-in was cancelled or expired.')

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
      code_verifier: saved.verifier,
    }),
  })
  const tokens = (await res.json().catch(() => null)) as { id_token?: string } | null
  if (!res.ok || !tokens?.id_token) return fail('Google sign-in failed. Try again.')
  // The ID token came straight from Google's token endpoint over TLS, so its claims
  // can be trusted without a signature check (OpenID Connect Core 3.1.3.7); still
  // check issuer, audience and expiry.
  const claims = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString('utf8')) as {
    iss: string; aud: string; exp: number; sub: string; email?: string; email_verified?: boolean; name?: string
  }
  const validIss = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com'
  if (!validIss || claims.aud !== config.google.clientId || claims.exp * 1000 < Date.now()) return fail('Google sign-in failed. Try again.')
  const email = normEmail(claims.email)
  if (!email || !claims.email_verified) return fail('Your Google account has no verified email.')

  const [bySub] = await sql<{ id: string }[]>`SELECT id FROM users WHERE google_sub = ${claims.sub}`
  const userId = bySub?.id ?? (await verifiedSignIn(email, { googleSub: claims.sub, name: claims.name ?? null }))
  await startSession(c, userId)
  return c.redirect(saved.ret)
})

/* ------------------------------------------------- QR sign-in (car ↔ phone) */

const PAIR_MINUTES = 5

auth.post('/qr/start', async (c) => {
  if (!hit(`qr:${clientIp(c)}`, 40, 60 * MIN)) return tooMany(c)
  const pollToken = randomToken()
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = pairingCode()
    const [row] = await sql<{ expires_at: Date }[]>`
      INSERT INTO qr_pairings (code, poll_token_hash, user_agent, expires_at)
      VALUES (${code}, ${sha256(pollToken)}, ${(c.req.header('user-agent') ?? '').slice(0, 300)}, now() + make_interval(mins => ${PAIR_MINUTES}))
      ON CONFLICT (code) DO NOTHING RETURNING expires_at`
    if (row) {
      // The client prefixes its own origin, so the QR always points at the host the car loaded.
      return c.json({ code, pollToken, path: `/link?c=${code}`, expiresAt: row.expires_at })
    }
  }
  return c.json({ error: 'Try again.' }, 500)
})

auth.post('/qr/poll', async (c) => {
  if (!hit(`qr-poll:${clientIp(c)}`, 240, MIN)) return tooMany(c)
  const token = (await body(c)).pollToken
  if (typeof token !== 'string') return c.json({ status: 'invalid' }, 400)
  const hash = sha256(token)
  const [row] = await sql<{ status: string; expired: boolean }[]>`
    SELECT status, expires_at < now() AS expired FROM qr_pairings WHERE poll_token_hash = ${hash}`
  if (!row) return c.json({ status: 'invalid' }, 404)
  if (row.status === 'pending') return c.json({ status: row.expired ? 'expired' : 'pending' })
  if (row.status === 'claimed') return c.json({ status: 'claimed' })
  // Approved: claim exactly once, then sign this browser (the car) in.
  const [claimed] = await sql<{ user_id: string }[]>`
    UPDATE qr_pairings SET status = 'claimed' WHERE poll_token_hash = ${hash} AND status = 'approved' RETURNING user_id`
  if (!claimed) return c.json({ status: 'claimed' })
  await startSession(c, claimed.user_id)
  return c.json({ status: 'approved', user: await publicUser(claimed.user_id) })
})

/** Phone side: check a code before showing the "Link car" button. */
auth.get('/qr/:code', async (c) => {
  if (!hit(`qr-look:${clientIp(c)}`, 60, MIN)) return tooMany(c)
  const code = c.req.param('code').toUpperCase()
  const [row] = await sql<{ status: string; expired: boolean }[]>`
    SELECT status, expires_at < now() AS expired FROM qr_pairings WHERE code = ${code}`
  if (!row || row.expired || row.status !== 'pending') return c.json({ status: 'expired' }, 404)
  return c.json({ status: 'pending' })
})

auth.post('/qr/approve', requireUser, async (c) => {
  if (!hit(`qr-approve:${clientIp(c)}`, 30, 15 * MIN)) return tooMany(c)
  const code = String((await body(c)).code ?? '').toUpperCase()
  const [row] = await sql`
    UPDATE qr_pairings SET status = 'approved', user_id = ${c.get('user')!.id}
    WHERE code = ${code} AND status = 'pending' AND expires_at > now() RETURNING id`
  if (!row) return c.json({ error: 'This code has expired. Show a new QR code in the car.' }, 410)
  return c.json({ ok: true })
})
