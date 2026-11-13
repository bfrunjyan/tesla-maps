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

describe('the driver’s car', () => {
  it('requires sign-in', async () => {
    expect((await client().get('/api/vehicle')).status).toBe(401)
  })

  it('saves, replaces and clears the car', async () => {
    const c = await signedIn()
    expect((await c.get('/api/vehicle')).json.vehicle).toBeNull()
    await c.put('/api/vehicle', { vehicle: { model: 'model3', year: 2021, trim: 'lr' } })
    await c.put('/api/vehicle', { vehicle: { model: 'modely', year: 2023, trim: 'perf' } })
    expect((await c.get('/api/vehicle')).json.vehicle).toEqual({ model: 'modely', year: 2023, trim: 'perf' })
    await c.put('/api/vehicle', { vehicle: null })
    expect((await c.get('/api/vehicle')).json.vehicle).toBeNull()
  })

  it('rejects invalid cars', async () => {
    const c = await signedIn()
    expect((await c.put('/api/vehicle', { vehicle: { model: 'model3', year: 1999, trim: 'lr' } })).status).toBe(400)
    expect((await c.put('/api/vehicle', { vehicle: { model: 'DROP TABLE', year: 2022, trim: 'lr' } })).status).toBe(400)
    expect((await c.put('/api/vehicle', { vehicle: { model: 'model3', year: 2022 } })).status).toBe(400)
  })

  it('keeps each account’s car separate and removes it with the account', async () => {
    const a = await signedIn('a@example.com')
    const b = await signedIn('b@example.com')
    await a.put('/api/vehicle', { vehicle: { model: 'models', year: 2022, trim: 'plaid' } })
    expect((await b.get('/api/vehicle')).json.vehicle).toBeNull()
    await a.del('/api/auth/me')
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM vehicles`
    expect(n).toBe(0)
  })
})
