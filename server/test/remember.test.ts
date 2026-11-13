import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from '../db.ts'
import { client, resetDatabase } from './helpers.ts'

beforeEach(resetDatabase)
afterAll(() => sql.end())

/** A signed-in car with a remember token, as the app sets it up after sign-in. */
async function rememberedCar() {
  const car = client()
  await car.post('/api/auth/register', { email: 'car@example.com', password: 'longenough' })
  const { token } = (await car.post('/api/auth/remember')).json
  return { car, token: token as string }
}

describe('remember this car', () => {
  it('needs a signed-in session to issue a token', async () => {
    expect((await client().post('/api/auth/remember')).status).toBe(401)
  })

  it('signs the car back in after the browser wiped its cookies', async () => {
    const { car, token } = await rememberedCar()
    car.jar.clear() // the car's browser dropped every cookie
    expect((await car.get('/api/auth/me')).json.user).toBeNull()

    const r = await car.post('/api/auth/resume', { token })
    expect(r.status).toBe(200)
    expect(r.json.user.email).toBe('car@example.com')
    expect(r.json.token).toEqual(expect.any(String))
    expect(r.json.token).not.toBe(token)
    expect((await car.get('/api/auth/me')).json.user.email).toBe('car@example.com')
  })

  it('works once: the old token is spent, the new one works', async () => {
    const { token } = await rememberedCar()
    const first = await client().post('/api/auth/resume', { token })
    expect(first.status).toBe(200)
    expect((await client().post('/api/auth/resume', { token })).status).toBe(401)
    expect((await client().post('/api/auth/resume', { token: first.json.token })).status).toBe(200)
  })

  it('is cancelled by Sign out', async () => {
    const { car, token } = await rememberedCar()
    await car.post('/api/auth/logout', { rememberToken: token })
    expect((await client().post('/api/auth/resume', { token })).status).toBe(401)
  })

  it('replaces the device’s previous token instead of piling them up', async () => {
    const { car, token } = await rememberedCar()
    const next = (await car.post('/api/auth/remember', { previous: token })).json.token
    expect((await client().post('/api/auth/resume', { token })).status).toBe(401)
    expect((await client().post('/api/auth/resume', { token: next })).status).toBe(200)
  })

  it('expires after 90 days without use', async () => {
    const { token } = await rememberedCar()
    await sql`UPDATE remember_tokens SET expires_at = now() - interval '1 second'`
    expect((await client().post('/api/auth/resume', { token })).status).toBe(401)
  })

  it('rejects guessed tokens and disappears with the account', async () => {
    const { car, token } = await rememberedCar()
    expect((await client().post('/api/auth/resume', { token: 'guess' })).status).toBe(401)
    await car.del('/api/auth/me')
    expect((await client().post('/api/auth/resume', { token })).status).toBe(401)
  })

  it('keeps the regular session for 90 days, renewing on use', async () => {
    const r = await client().post('/api/auth/register', { email: 'p@example.com', password: 'longenough' })
    const cookie = r.res.headers.getSetCookie().find((c) => c.startsWith('cn_session='))!
    const expires = Date.parse(cookie.match(/Expires=([^;]+)/i)![1])
    const days = (expires - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(89)
    expect(days).toBeLessThan(91)
  })
})
