/**
 * A stand-in for Tesla, for tests and local development only (never mounted in
 * production). It speaks the few Fleet API calls Mapic uses: sign-in, tokens,
 * region, the car list and the battery reading.
 *
 *   npm test                 the API tests call it in place of Tesla
 *   TESLA_FAKE=1 npm run dev:api   then use "Connect Tesla" in the app;
 *                            change the car at /api/dev/tesla/set?pct=41&charging=Charging&asleep=0
 */
import { Hono } from 'hono'

export const FAKE_VIN = '5YJYGDEE7NF123456' // decodes to a 2022 Model Y
export const FAKE_VIN_2 = '5YJ3E1EA8KF654321' // a 2019 Model 3

const initial = () => ({
  cars: [{ vin: FAKE_VIN, display_name: 'Aragats', state: 'online' }] as { vin: string; display_name: string; state: string }[],
  pct: 72,
  rangeMiles: 201.4,
  charging: 'Disconnected',
  minutesToFull: 0,
  limit: 80,
  power: 0,
  asleep: false,
  /** Seconds a new access token lasts. */
  expiresIn: 28800,
  /** Tesla refuses refresh tokens (the driver removed the app). */
  revoked: false,
  /** HTTP status to answer vehicle_data with, instead of data. */
  failWith: 0,
  /** Bump `accessGen` alone to make the current access token stop working. */
  accessGen: 1,
  refreshGen: 1,
  calls: { token: 0, refresh: 0, region: 0, vehicles: 0, vehicleData: 0, cached: 0 },
  lastAuthorize: null as Record<string, string> | null,
  lastTokenBody: null as Record<string, string> | null,
})

export let fake = initial()
export function resetFakeTesla() {
  fake = initial()
}

const chargeState = (ageMs = 0) => ({
  battery_level: fake.pct,
  usable_battery_level: fake.pct,
  battery_range: fake.rangeMiles,
  charging_state: fake.charging,
  minutes_to_full_charge: fake.minutesToFull,
  charge_limit_soc: fake.limit,
  charger_power: fake.power,
  timestamp: Date.now() - ageMs,
})

export const fakeTesla = new Hono()

fakeTesla.get('/authorize', (c) => {
  const q = c.req.query()
  fake.lastAuthorize = q
  const esc = (v: string) => v.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)
  const done = (params: Record<string, string>) => esc(`${q.redirect_uri}?${new URLSearchParams({ state: q.state ?? '', ...params })}`)
  return c.html(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stand-in Tesla sign-in</title>
<body style="font:16px system-ui;max-width:420px;margin:15vh auto;padding:0 20px">
<h1 style="font-size:22px">Stand-in Tesla sign-in</h1>
<p>Local development only. This page plays the part of Tesla's sign-in.</p>
<p><a id="allow" href="${done({ code: 'fake-code' })}">Allow</a> &nbsp; <a id="cancel" href="${done({ error: 'login_cancelled' })}">Cancel</a></p>`)
})

fakeTesla.post('/token', async (c) => {
  const body = Object.fromEntries(new URLSearchParams(await c.req.text()))
  fake.lastTokenBody = body
  if (body.grant_type === 'authorization_code') {
    fake.calls.token++
    if (body.code !== 'fake-code') return c.json({ error: 'invalid_auth_code' }, 400)
  } else if (body.grant_type === 'refresh_token') {
    fake.calls.refresh++
    if (fake.revoked || body.refresh_token !== `refresh-${fake.refreshGen}`) return c.json({ error: 'login_required' }, 401)
    fake.refreshGen++
    fake.accessGen++
  } else {
    return c.json({ error: 'unsupported_grant_type' }, 400)
  }
  return c.json({ access_token: `access-${fake.accessGen}`, refresh_token: `refresh-${fake.refreshGen}`, expires_in: fake.expiresIn, token_type: 'Bearer' })
})

/** Like Tesla: only the newest access token is accepted here, so tests can expire one. */
const authorized = (header: string | undefined) => header === `Bearer access-${fake.accessGen}`

fakeTesla.get('/api/1/users/region', (c) => {
  fake.calls.region++
  if (!authorized(c.req.header('authorization'))) return c.json({ error: 'invalid bearer token' }, 401)
  const self = new URL(c.req.url)
  return c.json({ response: { region: 'eu', fleet_api_base_url: `${self.origin}${self.pathname.replace('/api/1/users/region', '')}` } })
})

fakeTesla.get('/api/1/vehicles', (c) => {
  fake.calls.vehicles++
  if (!authorized(c.req.header('authorization'))) return c.json({ error: 'invalid bearer token' }, 401)
  return c.json({ response: fake.cars.map((car, i) => ({ id: 100 + i, vehicle_id: 200 + i, ...car })), count: fake.cars.length })
})

fakeTesla.get('/api/1/vehicles/:vin/vehicle_data', (c) => {
  fake.calls.vehicleData++
  if (!authorized(c.req.header('authorization'))) return c.json({ error: 'invalid bearer token' }, 401)
  if (fake.failWith) return c.json({ response: null, error: 'stand-in failure' }, fake.failWith as 500)
  if (!fake.cars.some((car) => car.vin === c.req.param('vin'))) return c.json({ response: null, error: 'not_found' }, 404)
  if (fake.asleep) return c.json({ response: null, error: 'vehicle unavailable: vehicle is offline or asleep' }, 408)
  return c.json({ response: { vin: c.req.param('vin'), state: 'online', charge_state: chargeState() } })
})

fakeTesla.get('/api/1/vehicles/:vin/vehicle_data_cached', (c) => {
  fake.calls.cached++
  if (!authorized(c.req.header('authorization'))) return c.json({ error: 'invalid bearer token' }, 401)
  return c.json({ response: { charge_state: chargeState(3 * 3600_000) } })
})

/** Local development: change what the stand-in car reports. */
fakeTesla.get('/set', (c) => {
  const q = c.req.query()
  if (q.pct) fake.pct = Number(q.pct)
  if (q.range) fake.rangeMiles = Number(q.range)
  if (q.charging) fake.charging = q.charging
  if (q.minutes) fake.minutesToFull = Number(q.minutes)
  if (q.power) fake.power = Number(q.power)
  if (q.asleep) fake.asleep = q.asleep === '1'
  if (q.cars === '2') fake.cars = [fake.cars[0], { vin: FAKE_VIN_2, display_name: 'Sevan', state: 'online' }]
  return c.json({ pct: fake.pct, rangeMiles: fake.rangeMiles, charging: fake.charging, asleep: fake.asleep, cars: fake.cars.length })
})
