import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from '../db.ts'
import { client, resetDatabase } from './helpers.ts'

beforeEach(resetDatabase)
afterAll(() => sql.end())

/** Email codes are printed to the log in development; capture the next one. */
async function requestCode(c: ReturnType<typeof client>, email: string) {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const r = await c.post('/api/auth/email/start', { email })
  const line = log.mock.calls.map((a) => String(a[0])).find((l) => l.includes('sign-in code'))
  log.mockRestore()
  expect(r.status).toBe(200)
  return line!.match(/(\d{6})$/)![1]
}

describe('health and config', () => {
  it('reports healthy with a database connection', async () => {
    const r = await client().get('/api/health')
    expect(r).toMatchObject({ status: 200, json: { ok: true } })
  })

  it('lists the available sign-in methods', async () => {
    const r = await client().get('/api/auth/config')
    expect(r.json.methods).toEqual({ qr: true, emailCode: true, password: true, google: false })
  })

  it('returns no user when signed out', async () => {
    expect((await client().get('/api/auth/me')).json).toEqual({ user: null })
  })
})

describe('email and password', () => {
  it('registers, keeps the session, logs out and logs back in', async () => {
    const c = client()
    const reg = await c.post('/api/auth/register', { email: 'Driver@Example.com', password: 'correct horse' })
    expect(reg.status).toBe(200)
    expect(reg.json.user).toMatchObject({ email: 'driver@example.com', emailVerified: false, hasPassword: true })
    expect((await c.get('/api/auth/me')).json.user.email).toBe('driver@example.com')

    await c.post('/api/auth/logout')
    expect((await c.get('/api/auth/me')).json.user).toBeNull()

    const login = await c.post('/api/auth/login', { email: 'driver@example.com', password: 'correct horse' })
    expect(login.status).toBe(200)
  })

  it('sets an httpOnly, SameSite=Lax session cookie', async () => {
    const r = await client().post('/api/auth/register', { email: 'a@example.com', password: 'longenough' })
    const cookie = r.res.headers.getSetCookie().find((c) => c.startsWith('cn_session='))!
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
  })

  it('rejects duplicates, short passwords and bad emails', async () => {
    const c = client()
    await c.post('/api/auth/register', { email: 'a@example.com', password: 'longenough' })
    expect((await client().post('/api/auth/register', { email: 'A@example.com', password: 'another one' })).status).toBe(409)
    expect((await client().post('/api/auth/register', { email: 'b@example.com', password: 'short' })).status).toBe(400)
    expect((await client().post('/api/auth/register', { email: 'not-an-email', password: 'longenough' })).status).toBe(400)
  })

  it('gives the same answer for a wrong password and an unknown email', async () => {
    await client().post('/api/auth/register', { email: 'a@example.com', password: 'longenough' })
    const wrong = await client().post('/api/auth/login', { email: 'a@example.com', password: 'nope nope' })
    const unknown = await client().post('/api/auth/login', { email: 'nobody@example.com', password: 'nope nope' })
    expect(wrong.status).toBe(401)
    expect(unknown.status).toBe(401)
    expect(wrong.json.error).toBe(unknown.json.error)
  })

  it('rate-limits repeated logins for one email', async () => {
    await client().post('/api/auth/register', { email: 'a@example.com', password: 'longenough' })
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) statuses.push((await client().post('/api/auth/login', { email: 'a@example.com', password: 'wrong guess' })).status)
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true)
    expect(statuses[10]).toBe(429)
  })
})

describe('email one-time code', () => {
  it('signs in with the right code, once', async () => {
    const c = client()
    const code = await requestCode(c, 'new@example.com')
    expect((await c.post('/api/auth/email/verify', { email: 'new@example.com', code: '000000' === code ? '111111' : '000000' })).status).toBe(400)
    const ok = await c.post('/api/auth/email/verify', { email: 'new@example.com', code })
    expect(ok.status).toBe(200)
    expect(ok.json.user).toMatchObject({ email: 'new@example.com', emailVerified: true, hasPassword: false })
    expect((await client().post('/api/auth/email/verify', { email: 'new@example.com', code })).status).toBe(400)
  })

  it('stops accepting a code after 5 wrong attempts', async () => {
    const c = client()
    const code = await requestCode(c, 'x@example.com')
    const wrong = code === '123456' ? '654321' : '123456'
    for (let i = 0; i < 5; i++) await c.post('/api/auth/email/verify', { email: 'x@example.com', code: wrong })
    expect((await c.post('/api/auth/email/verify', { email: 'x@example.com', code })).status).toBe(400)
  })

  it('blocks takeover: proving the email removes a password someone else set', async () => {
    const attacker = client()
    await attacker.post('/api/auth/register', { email: 'victim@example.com', password: 'attacker-pass' })
    const owner = client()
    const code = await requestCode(owner, 'victim@example.com')
    await owner.post('/api/auth/email/verify', { email: 'victim@example.com', code })
    expect((await attacker.get('/api/auth/me')).json.user).toBeNull() // attacker's session revoked
    expect((await client().post('/api/auth/login', { email: 'victim@example.com', password: 'attacker-pass' })).status).toBe(401)
  })
})

describe('QR sign-in (car ↔ phone)', () => {
  it('signs the car in after the phone approves, exactly once', async () => {
    const car = client()
    const phone = client()
    const start = await car.post('/api/auth/qr/start')
    const { code, pollToken, path } = start.json
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    expect(path).toBe(`/link?c=${code}`)

    expect((await car.post('/api/auth/qr/poll', { pollToken })).json.status).toBe('pending')
    expect((await phone.get(`/api/auth/qr/${code}`)).json.status).toBe('pending')
    expect((await phone.post('/api/auth/qr/approve', { code })).status).toBe(401) // phone not signed in

    await phone.post('/api/auth/register', { email: 'p@example.com', password: 'longenough' })
    expect((await phone.post('/api/auth/qr/approve', { code })).status).toBe(200)

    const done = await car.post('/api/auth/qr/poll', { pollToken })
    expect(done.json).toMatchObject({ status: 'approved', user: { email: 'p@example.com' } })
    expect((await car.get('/api/auth/me')).json.user.email).toBe('p@example.com')

    expect((await client().post('/api/auth/qr/poll', { pollToken })).json.status).toBe('claimed')
    expect((await phone.post('/api/auth/qr/approve', { code })).status).toBe(410)
  })

  it('ignores a guessed poll token', async () => {
    await client().post('/api/auth/qr/start')
    expect((await client().post('/api/auth/qr/poll', { pollToken: 'guess' })).json.status).toBe('invalid')
  })

  it('expires codes after 5 minutes', async () => {
    const car = client()
    const { code, pollToken } = (await car.post('/api/auth/qr/start')).json
    await sql`UPDATE qr_pairings SET expires_at = now() - interval '1 second' WHERE code = ${code}`
    expect((await car.post('/api/auth/qr/poll', { pollToken })).json.status).toBe('expired')
    expect((await client().get(`/api/auth/qr/${code}`)).status).toBe(404)
  })
})

describe('request protection', () => {
  it('rejects state changes from another website', async () => {
    const r = await client().post('/api/auth/logout', {}, { Origin: 'https://evil.example' })
    expect(r.status).toBe(403)
  })

  it('rejects form posts (non-JSON)', async () => {
    const r = await client().raw('POST', '/api/auth/logout', undefined, { 'Content-Type': 'application/x-www-form-urlencoded' })
    expect(r.status).toBe(415)
  })

  it('returns 404 JSON for unknown API paths', async () => {
    expect((await client().get('/api/nope')).status).toBe(404)
  })
})

describe('account deletion', () => {
  it('deletes the user, their places and their session', async () => {
    const c = client()
    await c.post('/api/auth/register', { email: 'gone@example.com', password: 'longenough' })
    await c.put('/api/places/home', { place: { id: 'H', name: 'Home', lon: 44.5, lat: 40.2 } })
    expect((await c.del('/api/auth/me')).status).toBe(200)
    expect((await c.get('/api/auth/me')).json.user).toBeNull()
    const [{ users }] = await sql<{ users: number }[]>`SELECT count(*)::int AS users FROM users`
    const [{ places }] = await sql<{ places: number }[]>`SELECT count(*)::int AS places FROM places`
    expect({ users, places }).toEqual({ users: 0, places: 0 })
  })
})
