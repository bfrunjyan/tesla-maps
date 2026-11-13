import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../app.ts'
import { config } from '../config.ts'
import { sql } from '../db.ts'
import { FAKE_VIN, FAKE_VIN_2, fake, fakeTesla, resetFakeTesla } from '../dev/fakeTesla.ts'
import { resetTeslaReads } from '../lib/tesla.ts'
import { client, resetDatabase } from './helpers.ts'

// Tesla is played by the stand-in in server/dev/fakeTesla.ts: nothing leaves this machine.
const TESLA = 'http://tesla.test'
const realFetch = globalThis.fetch
beforeAll(() => {
  vi.stubGlobal('fetch', (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    return url.startsWith(TESLA) ? fakeTesla.request(url, init) : realFetch(input, init)
  })
})
beforeEach(async () => {
  await resetDatabase()
  resetFakeTesla()
  resetTeslaReads()
  config.tesla.dailyReads = 60
})
afterAll(async () => {
  vi.unstubAllGlobals()
  await sql.end()
})

type Client = ReturnType<typeof client>

async function signedIn(email = 'd@example.com') {
  const c = client()
  await c.post('/api/auth/register', { email, password: 'longenough' })
  return c
}

/** Starts Tesla sign-in and returns the state Tesla must send back. */
async function start(c: Client) {
  const r = await c.get('/api/tesla/start')
  return { r, url: new URL(r.res.headers.get('location') ?? 'http://none') }
}

/** Goes through the whole sign-in, as if the driver pressed Allow at Tesla. */
async function connect(c: Client) {
  const { url } = await start(c)
  return c.get(`/api/tesla/callback?code=fake-code&state=${url.searchParams.get('state')}`)
}

/** Lets the next reading through without waiting a minute. */
const waitAMinute = () => sql`UPDATE tesla_links SET read_at = now() - interval '2 minutes'`

describe('Connect Tesla: availability', () => {
  it('tells guests whether it is available, and that nothing is connected', async () => {
    expect((await client().get('/api/tesla/status')).json).toEqual({ enabled: true, connected: false, cars: [], vin: null, reading: null })
  })

  it('is off when the Tesla keys are not set', async () => {
    const id = config.tesla.clientId
    config.tesla.clientId = ''
    try {
      const c = await signedIn()
      expect((await c.get('/api/tesla/status')).json.enabled).toBe(false)
      expect((await c.get('/api/tesla/start')).status).toBe(503)
      expect((await c.post('/api/tesla/read')).status).toBe(503)
    } finally {
      config.tesla.clientId = id
    }
  })

  it('serves the public key Tesla asks for, only when one is set', async () => {
    const path = '/.well-known/appspecific/com.tesla.3p.public-key.pem'
    expect((await client().get(path)).status).toBe(404)
    config.tesla.publicKey = '-----BEGIN PUBLIC KEY-----\nMFkw\n-----END PUBLIC KEY-----'
    try {
      const res = await app.request(path)
      expect(res.status).toBe(200)
      expect(await res.text()).toBe('-----BEGIN PUBLIC KEY-----\nMFkw\n-----END PUBLIC KEY-----\n')
    } finally {
      config.tesla.publicKey = ''
    }
  })
})

describe('Connect Tesla: sign-in', () => {
  it('asks guests to sign in to Mapic first', async () => {
    const r = await client().get('/api/tesla/start')
    expect(r.status).toBe(302)
    expect(r.res.headers.get('location')).toBe('/?tesla=signin')
  })

  it('sends the driver to Tesla asking only to read the car', async () => {
    const { r, url } = await start(await signedIn())
    expect(r.status).toBe(302)
    expect(`${url.origin}${url.pathname}`).toBe(`${TESLA}/authorize`)
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: 'test-client',
      redirect_uri: 'http://localhost:5174/api/tesla/callback',
      scope: 'openid offline_access vehicle_device_data',
    })
    expect(url.searchParams.get('state')!.length).toBeGreaterThan(20)
  })

  it('connects, finds the car and stores the tokens encrypted', async () => {
    const c = await signedIn()
    const r = await connect(c)
    expect(r.res.headers.get('location')).toBe('/?tesla=connected')
    expect(fake.lastTokenBody).toMatchObject({
      grant_type: 'authorization_code',
      client_id: 'test-client',
      client_secret: 'test-secret',
      code: 'fake-code',
      audience: TESLA,
      redirect_uri: 'http://localhost:5174/api/tesla/callback',
    })
    expect((await c.get('/api/tesla/status')).json).toEqual({
      enabled: true,
      connected: true,
      cars: [{ vin: FAKE_VIN, name: 'Aragats', model: 'modely', year: 2022 }],
      vin: FAKE_VIN,
      reading: null,
    })
    const [row] = await sql<{ access_token: string; refresh_token: string; api_base: string }[]>`SELECT access_token, refresh_token, api_base FROM tesla_links`
    expect(row.access_token).not.toContain('access-1')
    expect(row.refresh_token).not.toContain('refresh-1')
    expect(row.api_base).toBe(TESLA)
  })

  it('refuses an answer that does not match the sign-in it started', async () => {
    const c = await signedIn()
    await start(c)
    expect((await c.get('/api/tesla/callback?code=fake-code&state=forged')).res.headers.get('location')).toBe('/?tesla=failed')
    // The state works once: the same answer can't be replayed.
    const { url } = await start(c)
    const good = `/api/tesla/callback?code=fake-code&state=${url.searchParams.get('state')}`
    expect((await c.get(good)).res.headers.get('location')).toBe('/?tesla=connected')
    expect((await c.get(good)).res.headers.get('location')).toBe('/?tesla=failed')
    expect((await (await signedIn('other@example.com')).get(good)).res.headers.get('location')).toBe('/?tesla=failed')
  })

  it('does not let one driver finish a sign-in another driver started', async () => {
    const a = await signedIn('a@example.com')
    const b = await signedIn('b@example.com')
    const { url } = await start(a)
    // b somehow holds a's state cookie and Tesla's answer.
    b.jar.set('cn_tesla', a.jar.get('cn_tesla')!)
    const r = await b.get(`/api/tesla/callback?code=fake-code&state=${url.searchParams.get('state')}`)
    expect(r.res.headers.get('location')).toBe('/?tesla=failed')
    expect((await b.get('/api/tesla/status')).json.connected).toBe(false)
  })

  it('reports a cancelled sign-in, a refused code and an account with no car', async () => {
    const c = await signedIn()
    let s = (await start(c)).url.searchParams.get('state')
    expect((await c.get(`/api/tesla/callback?error=login_cancelled&state=${s}`)).res.headers.get('location')).toBe('/?tesla=cancelled')
    s = (await start(c)).url.searchParams.get('state')
    expect((await c.get(`/api/tesla/callback?code=wrong&state=${s}`)).res.headers.get('location')).toBe('/?tesla=failed')
    fake.cars = []
    expect((await connect(c)).res.headers.get('location')).toBe('/?tesla=nocar')
    expect((await c.get('/api/tesla/status')).json.connected).toBe(false)
  })
})

describe('Connect Tesla: reading the battery', () => {
  it('requires sign-in', async () => {
    expect((await client().post('/api/tesla/read')).status).toBe(401)
  })

  it('says so when no Tesla is connected', async () => {
    const c = await signedIn()
    expect((await c.post('/api/tesla/read')).json).toMatchObject({ connected: false, reading: null })
    expect(fake.calls.vehicleData).toBe(0)
  })

  it('reads charge level, range and charging state from the car', async () => {
    const c = await signedIn()
    await connect(c)
    Object.assign(fake, { pct: 41, rangeMiles: 118, charging: 'Charging', minutesToFull: 35, power: 11, limit: 80 })
    const r = await c.post('/api/tesla/read')
    expect(r.json).toMatchObject({
      connected: true,
      note: null,
      reading: { pct: 41, rangeKm: 190, charging: 'charging', minutesToFull: 35, powerKw: 11, limitPct: 80, live: true },
    })
    // Kept for the next visit.
    expect((await c.get('/api/tesla/status')).json.reading.pct).toBe(41)
  })

  it('asks Tesla at most once a minute, even when two requests arrive together', async () => {
    const c = await signedIn()
    await connect(c)
    const [a, b] = await Promise.all([c.post('/api/tesla/read'), c.post('/api/tesla/read')])
    expect(a.json.reading.pct).toBe(72)
    expect(b.json.reading.pct).toBe(72)
    fake.pct = 60
    expect((await c.post('/api/tesla/read')).json.reading.pct).toBe(72)
    expect(fake.calls.vehicleData).toBe(1)
    await waitAMinute()
    expect((await c.post('/api/tesla/read')).json.reading.pct).toBe(60)
    expect(fake.calls.vehicleData).toBe(2)
  })

  it('shows the last report when the car is asleep, and never wakes it', async () => {
    const c = await signedIn()
    await connect(c)
    fake.asleep = true
    const r = await c.post('/api/tesla/read')
    expect(r.json.note).toBe('asleep')
    expect(r.json.reading).toMatchObject({ pct: 72, live: false })
    expect(Date.now() - Date.parse(r.json.reading.at)).toBeGreaterThan(2 * 3600_000)
  })

  it('renews an expired token and keeps reading', async () => {
    const c = await signedIn()
    await connect(c)
    await sql`UPDATE tesla_links SET expires_at = now() - interval '1 minute'`
    expect((await c.post('/api/tesla/read')).json.reading.pct).toBe(72)
    expect(fake.calls.refresh).toBe(1)
    expect(fake.lastTokenBody).toMatchObject({ grant_type: 'refresh_token', client_id: 'test-client', refresh_token: 'refresh-1' })
    // The renewed tokens were saved: the next reading needs no renewal.
    await waitAMinute()
    await c.post('/api/tesla/read')
    expect(fake.calls.refresh).toBe(1)
  })

  it('renews when Tesla stops accepting the token early', async () => {
    const c = await signedIn()
    await connect(c)
    fake.accessGen++
    expect((await c.post('/api/tesla/read')).json).toMatchObject({ note: null, reading: { pct: 72 } })
    expect(fake.calls.refresh).toBe(1)
  })

  it('disconnects when the driver removed Mapic in their Tesla account', async () => {
    const c = await signedIn()
    await connect(c)
    fake.revoked = true
    fake.accessGen++
    expect((await c.post('/api/tesla/read')).json).toMatchObject({ connected: false, reading: null })
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM tesla_links`
    expect(n).toBe(0)
  })

  it('keeps the last reading when Tesla has a problem, without counting it', async () => {
    const c = await signedIn()
    await connect(c)
    await c.post('/api/tesla/read')
    await waitAMinute()
    fake.failWith = 503
    const r = await c.post('/api/tesla/read')
    expect(r.json).toMatchObject({ connected: true, note: 'unavailable', reading: { pct: 72 } })
    const [{ reads_count }] = await sql<{ reads_count: number }[]>`SELECT reads_count FROM tesla_links`
    expect(reads_count).toBe(1)
  })

  it('stops asking Tesla after the day’s allowance, and starts again the next day', async () => {
    config.tesla.dailyReads = 2
    const c = await signedIn()
    await connect(c)
    await c.post('/api/tesla/read')
    await waitAMinute()
    await c.post('/api/tesla/read')
    await waitAMinute()
    fake.pct = 50
    const r = await c.post('/api/tesla/read')
    expect(r.json).toMatchObject({ note: 'limit', reading: { pct: 72 } })
    expect(fake.calls.vehicleData).toBe(2)
    await sql`UPDATE tesla_links SET reads_day = reads_day - 1`
    expect((await c.post('/api/tesla/read')).json).toMatchObject({ note: null, reading: { pct: 50 } })
  })
})

describe('Connect Tesla: cars and disconnecting', () => {
  it('lets a driver with two cars choose which one to read', async () => {
    fake.cars.push({ vin: FAKE_VIN_2, display_name: 'Sevan', state: 'online' })
    const c = await signedIn()
    await connect(c)
    await c.post('/api/tesla/read')
    const r = await c.put('/api/tesla/car', { vin: FAKE_VIN_2 })
    expect(r.json).toMatchObject({ vin: FAKE_VIN_2, reading: null })
    expect(r.json.cars).toHaveLength(2)
    expect((await c.put('/api/tesla/car', { vin: '5YJ3E1EA8KF000000' })).status).toBe(400)
    expect((await c.put('/api/tesla/car', { vin: 12 })).status).toBe(400)
    // Connecting again keeps the chosen car.
    await connect(c)
    expect((await c.get('/api/tesla/status')).json.vin).toBe(FAKE_VIN_2)
  })

  it('disconnects on request and forgets the tokens', async () => {
    const c = await signedIn()
    await connect(c)
    expect((await c.del('/api/tesla')).status).toBe(200)
    expect((await c.get('/api/tesla/status')).json.connected).toBe(false)
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM tesla_links`
    expect(n).toBe(0)
  })

  it('keeps each account’s Tesla separate and removes it with the account', async () => {
    const a = await signedIn('a@example.com')
    const b = await signedIn('b@example.com')
    await connect(a)
    expect((await b.get('/api/tesla/status')).json.connected).toBe(false)
    expect((await b.post('/api/tesla/read')).json.connected).toBe(false)
    await a.del('/api/auth/me')
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM tesla_links`
    expect(n).toBe(0)
  })
})
