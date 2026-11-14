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

const opera = { id: 'g-opera', name: 'Opera Theatre', address: '36 Tumanyan St', lon: 44.5149, lat: 40.1858, category: 'attraction' }
const cascade = { id: 'g-cascade', name: 'Cascade', address: '10 Tamanyan St', lon: 44.5157, lat: 40.1912, category: 'attraction' }

describe('send to car', () => {
  it('requires sign-in', async () => {
    expect((await client().get('/api/inbox')).status).toBe(401)
    expect((await client().post('/api/inbox', { place: opera })).status).toBe(401)
  })

  it('hands the car the place sent from the phone, once', async () => {
    const phone = await signedIn()
    expect((await phone.get('/api/inbox')).json.place).toBeNull()
    expect((await phone.post('/api/inbox', { place: opera })).status).toBe(200)
    const got = await phone.get('/api/inbox')
    expect(got.json.place).toMatchObject({ name: 'Opera Theatre', lon: 44.5149, lat: 40.1858 })
    await phone.post('/api/inbox/seen', { sentAt: got.json.sentAt })
    expect((await phone.get('/api/inbox')).json.place).toBeNull()
  })

  it('keeps only the newest place, and doesn’t lose one sent while the car was showing the last', async () => {
    const phone = await signedIn()
    await phone.post('/api/inbox', { place: opera })
    const first = (await phone.get('/api/inbox')).json
    await new Promise((r) => setTimeout(r, 10))
    await phone.post('/api/inbox', { place: cascade })
    await phone.post('/api/inbox/seen', { sentAt: first.sentAt }) // the car acknowledges the older one
    expect((await phone.get('/api/inbox')).json.place).toMatchObject({ name: 'Cascade' })
  })

  it('doesn’t offer a place back to the phone that sent it', async () => {
    const phone = await signedIn()
    await phone.post('/api/inbox', { place: opera, device: 'phone-1234abcd' })
    expect((await phone.get('/api/inbox?device=phone-1234abcd')).json.place).toBeNull()
    expect((await phone.get('/api/inbox?device=car-5678efgh')).json.place).toMatchObject({ name: 'Opera Theatre' })
  })

  it('forgets a place after a day', async () => {
    const phone = await signedIn()
    await phone.post('/api/inbox', { place: opera })
    await sql`UPDATE car_inbox SET sent_at = now() - interval '25 hours'`
    expect((await phone.get('/api/inbox')).json.place).toBeNull()
  })

  it('rejects bad places and keeps accounts apart', async () => {
    const a = await signedIn('a@example.com')
    const b = await signedIn('b@example.com')
    expect((await a.post('/api/inbox', { place: { ...opera, lat: 200 } })).status).toBe(400)
    expect((await a.post('/api/inbox', {})).status).toBe(400)
    expect((await a.post('/api/inbox/seen', { sentAt: 'soon' })).status).toBe(400)
    await a.post('/api/inbox', { place: opera })
    expect((await b.get('/api/inbox')).json.place).toBeNull()
    await a.del('/api/auth/me')
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM car_inbox`
    expect(n).toBe(0)
  })
})
