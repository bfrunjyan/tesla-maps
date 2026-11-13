import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { config } from '../config.ts'
import { sql } from '../db.ts'
import { randomToken, sha256 } from './crypto.ts'

export const SESSION_COOKIE = 'cn_session'

export interface SessionUser {
  id: string
  email: string
  name: string | null
  emailVerified: boolean
  hasPassword: boolean
}

export type AppEnv = { Variables: { user: SessionUser | null; sessionId: string | null } }

/** Create a session for `userId` and set the cookie on the response. */
export async function startSession(c: Context, userId: string) {
  const token = randomToken()
  const expires = new Date(Date.now() + config.sessionDays * 86400_000)
  await sql`
    INSERT INTO sessions (user_id, token_hash, user_agent, expires_at)
    VALUES (${userId}, ${sha256(token)}, ${(c.req.header('user-agent') ?? '').slice(0, 300)}, ${expires})`
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'Lax',
    path: '/',
    expires,
  })
}

export async function endSession(c: Context) {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) await sql`DELETE FROM sessions WHERE token_hash = ${sha256(token)}`
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: config.secureCookies })
}

/** Loads the signed-in user (if any) for every API request. */
export const loadSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('user', null)
  c.set('sessionId', null)
  const token = getCookie(c, SESSION_COOKIE)
  if (token) {
    const rows = await sql<(SessionUser & { sessionId: string; lastSeen: Date })[]>`
      SELECT s.id AS "sessionId", s.last_seen_at AS "lastSeen",
             u.id, u.email, u.name, u.email_verified AS "emailVerified",
             (u.password_hash IS NOT NULL) AS "hasPassword"
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ${sha256(token)} AND s.expires_at > now()`
    const row = rows[0]
    if (row) {
      const { sessionId, lastSeen, ...user } = row
      c.set('user', user)
      c.set('sessionId', sessionId)
      // Sliding expiry, updated at most hourly.
      if (Date.now() - new Date(lastSeen).getTime() > 3600_000) {
        const expires = new Date(Date.now() + config.sessionDays * 86400_000)
        await sql`UPDATE sessions SET last_seen_at = now(), expires_at = ${expires} WHERE id = ${sessionId}`
        setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure: config.secureCookies, sameSite: 'Lax', path: '/', expires })
      }
    } else {
      deleteCookie(c, SESSION_COOKIE, { path: '/', secure: config.secureCookies })
    }
  }
  await next()
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('user')) return c.json({ error: 'Sign in required' }, 401)
  await next()
}

/**
 * CSRF guard for state-changing requests: cookies are SameSite=Lax, and we
 * additionally require a JSON body (forms can't send it cross-site without
 * CORS) and a same-origin Origin header when present.
 */
export const csrfGuard: MiddlewareHandler = async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('origin')
    if (origin && origin !== config.appUrl && !(!config.production && /^http:\/\/localhost(:\d+)?$/.test(origin))) {
      return c.json({ error: 'Bad origin' }, 403)
    }
    const type = c.req.header('content-type') ?? ''
    if (c.req.method !== 'DELETE' && !type.startsWith('application/json')) {
      return c.json({ error: 'Expected JSON' }, 415)
    }
  }
  await next()
}
