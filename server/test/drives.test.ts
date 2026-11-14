import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from '../db.ts'
import { client, resetDatabase } from './helpers.ts'

beforeEach(resetDatabase)
afterAll(() => sql.end())

async function signedIn(email = 'd@example.com') {
  const c = client()
  await c.post('/api/auth/register', { email, password: 'longenough' })
  return c
}

const CAR = '0b0f7a52-3c8e-4f8a-9d55-2d6f1c1a0001'
const PHONE = '0b0f7a52-3c8e-4f8a-9d55-2d6f1c1a0002'
const day = (d: string, metres: number, wh = metres / 7, seconds = metres / 10) => ({ day: d, metres, wh: Math.round(wh), seconds: Math.round(seconds) })
const range = '?from=2026-11-01&to=2026-11-30'

describe('driving history', () => {
  it('requires sign-in', async () => {
    expect((await client().get(`/api/drives${range}`)).status).toBe(401)
    expect((await client().put('/api/drives', { logId: CAR, days: [] })).status).toBe(401)
  })

  it('saves days and reads them back in a range', async () => {
    const c = await signedIn()
    await c.put('/api/drives', { logId: CAR, days: [day('2026-11-13', 12000), day('2026-11-14', 30500)] })
    const r = await c.get(`/api/drives${range}`)
    expect(r.status).toBe(200)
    expect(r.json.days).toEqual([
      { day: '2026-11-13', metres: 12000, wh: 1714, seconds: 1200 },
      { day: '2026-11-14', metres: 30500, wh: 4357, seconds: 3050 },
    ])
    expect((await c.get('/api/drives?from=2026-11-14&to=2026-11-14')).json.days).toHaveLength(1)
  })

  it('takes a log’s newest running total, and never lets a late, older one shrink it', async () => {
    const c = await signedIn()
    await c.put('/api/drives', { logId: CAR, days: [day('2026-11-14', 10000)] })
    await c.put('/api/drives', { logId: CAR, days: [day('2026-11-14', 25000)] })
    await c.put('/api/drives', { logId: CAR, days: [day('2026-11-14', 10000)] }) // retried old request
    expect((await c.get(`/api/drives${range}`)).json.days[0].metres).toBe(25000)
  })

  it('adds up the logs of different devices for the same day', async () => {
    const c = await signedIn()
    await c.put('/api/drives', { logId: CAR, days: [day('2026-11-14', 20000)] })
    await c.put('/api/drives', { logId: PHONE, days: [day('2026-11-14', 5000)] })
    expect((await c.get(`/api/drives${range}`)).json.days[0].metres).toBe(25000)
  })

  it('rejects bad input', async () => {
    const c = await signedIn()
    const bad = [
      { logId: 'not-a-uuid', days: [] },
      { logId: CAR, days: 'x' },
      { logId: CAR, days: [{ day: '14/11/2026', metres: 1, wh: 1, seconds: 1 }] },
      { logId: CAR, days: [day('2026-11-14', -5)] },
      { logId: CAR, days: [day('2026-11-14', 3_000_000)] },
      { logId: CAR, days: [{ ...day('2026-11-14', 100), seconds: 90_000 }] },
      { logId: CAR, days: [day('2999-01-01', 100)] },
    ]
    for (const body of bad) expect((await c.put('/api/drives', body)).status).toBe(400)
    expect((await c.get('/api/drives?from=2026-11-30&to=2026-11-01')).status).toBe(400)
    expect((await c.get('/api/drives?from=yesterday&to=2026-11-01')).status).toBe(400)
  })

  it('keeps each account’s history separate and removes it with the account', async () => {
    const a = await signedIn('a@example.com')
    const b = await signedIn('b@example.com')
    await a.put('/api/drives', { logId: CAR, days: [day('2026-11-14', 9000)] })
    expect((await b.get(`/api/drives${range}`)).json.days).toEqual([])
    await a.del('/api/auth/me')
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM drive_days`
    expect(n).toBe(0)
  })
})
