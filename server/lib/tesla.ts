/**
 * Connect Tesla: links a driver's Tesla account and reads the battery from their car
 * through the Tesla Fleet API.
 *
 * Tesla bills every reading and asks apps not to poll, so readings are spaced out,
 * capped per driver per day, and the last one is kept in the database.
 */
import { config } from '../config.ts'
import { sql } from '../db.ts'
import { open, seal } from './secretBox.ts'
import { isFleetApiBase, isVin, parseCars, parseReading, type TeslaCar, type TeslaReading } from './teslaData.ts'

export const TESLA_SCOPES = 'openid offline_access vehicle_device_data'
export const teslaRedirectUri = () => `${config.appUrl}/api/tesla/callback`

/** A second request inside this window gets the stored reading instead of a new (billed) one. */
const MIN_READ_GAP_MS = 60_000
const TIMEOUT_MS = 20_000

/** Why a reading isn't live: the car sleeps, the day's allowance is used up, or Tesla didn't answer. */
export type ReadNote = 'asleep' | 'limit' | 'unavailable' | null

export interface TeslaStatus {
  connected: boolean
  cars: TeslaCar[]
  vin: string | null
  reading: TeslaReading | null
}

const NOT_CONNECTED: TeslaStatus = { connected: false, cars: [], vin: null, reading: null }

interface Tokens {
  access: string
  refresh: string
  expiresAt: Date
}

interface Link extends Tokens {
  userId: string
  apiBase: string
  cars: TeslaCar[]
  vin: string | null
  reading: TeslaReading | null
  readAt: Date | null
  readsToday: number
}

/* ------------------------------------------------------------- Tesla calls */

async function call(url: string, init: RequestInit = {}): Promise<{ status: number; json: unknown }> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
    return { status: res.status, json: await res.json().catch(() => null) }
  } catch {
    return { status: 0, json: null }
  }
}

const apiGet = (base: string, path: string, access: string) =>
  call(`${base}${path}`, { headers: { Authorization: `Bearer ${access}` } })

/** Token endpoint. Returns null when Tesla refuses (e.g. the driver removed Mapic's access). */
async function requestTokens(params: Record<string, string>, previousRefresh?: string): Promise<Tokens | 'refused' | 'failed'> {
  const { status, json } = await call(config.tesla.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.tesla.clientId, ...params }),
  })
  const t = (json ?? {}) as Record<string, unknown>
  if (status === 200 && typeof t.access_token === 'string') {
    const refresh = typeof t.refresh_token === 'string' ? t.refresh_token : previousRefresh
    if (!refresh) return 'failed'
    const seconds = typeof t.expires_in === 'number' && t.expires_in > 0 ? t.expires_in : 3600
    return { access: t.access_token, refresh, expiresAt: new Date(Date.now() + seconds * 1000) }
  }
  return status === 400 || status === 401 || status === 403 ? 'refused' : 'failed'
}

/** The Fleet API address for this driver's region (Europe and North America use different ones). */
async function regionBase(access: string): Promise<string> {
  const { status, json } = await apiGet(config.tesla.apiBase, '/api/1/users/region', access)
  const url = status === 200 ? ((json as { response?: { fleet_api_base_url?: unknown } })?.response?.fleet_api_base_url ?? null) : null
  return isFleetApiBase(url, config.tesla.apiBase) ? url.replace(/\/$/, '') : config.tesla.apiBase
}

/* ----------------------------------------------------------------- storage */

const secret = () => config.tesla.clientSecret

interface Row {
  access_token: string
  refresh_token: string
  expires_at: Date
  api_base: string
  cars: TeslaCar[]
  vin: string | null
  reading: TeslaReading | null
  read_at: Date | null
  reads_today: number
}

async function loadLink(userId: string): Promise<Link | null> {
  const [row] = await sql<Row[]>`
    SELECT access_token, refresh_token, expires_at, api_base, cars, vin, reading, read_at,
           CASE WHEN reads_day = (now() AT TIME ZONE 'utc')::date THEN reads_count ELSE 0 END AS reads_today
    FROM tesla_links WHERE user_id = ${userId}`
  if (!row) return null
  const access = open(row.access_token, secret())
  const refresh = open(row.refresh_token, secret())
  if (access == null || refresh == null) {
    // Sealed with a previous client secret: the link can't be used any more.
    await unlinkTesla(userId)
    return null
  }
  return {
    userId,
    access,
    refresh,
    expiresAt: new Date(row.expires_at),
    apiBase: row.api_base,
    cars: Array.isArray(row.cars) ? row.cars : [],
    vin: row.vin,
    reading: row.reading,
    readAt: row.read_at ? new Date(row.read_at) : null,
    readsToday: row.reads_today,
  }
}

async function saveTokens(userId: string, t: Tokens) {
  await sql`
    UPDATE tesla_links
    SET access_token = ${seal(t.access, secret())}, refresh_token = ${seal(t.refresh, secret())},
        expires_at = ${t.expiresAt}, updated_at = now()
    WHERE user_id = ${userId}`
}

export async function unlinkTesla(userId: string) {
  await sql`DELETE FROM tesla_links WHERE user_id = ${userId}`
}

const statusOf = (link: Link): TeslaStatus => ({ connected: true, cars: link.cars, vin: link.vin, reading: link.reading })

export async function teslaStatus(userId: string): Promise<TeslaStatus> {
  const link = await loadLink(userId)
  return link ? statusOf(link) : NOT_CONNECTED
}

/* ----------------------------------------------------------------- connect */

/**
 * Finishes Tesla sign-in: trades the code for tokens, finds the driver's region and
 * their cars, and stores the link. 'nocar' means the driver shared no car with Mapic.
 */
export async function connectTesla(userId: string, code: string): Promise<'connected' | 'nocar' | 'failed'> {
  const tokens = await requestTokens({
    grant_type: 'authorization_code',
    client_secret: config.tesla.clientSecret,
    code,
    audience: config.tesla.apiBase,
    redirect_uri: teslaRedirectUri(),
  })
  if (typeof tokens === 'string') return 'failed'
  const apiBase = await regionBase(tokens.access)
  const list = await apiGet(apiBase, '/api/1/vehicles', tokens.access)
  if (list.status !== 200) return 'failed'
  const cars = parseCars(list.json)
  if (!cars.length) return 'nocar'
  await sql`
    INSERT INTO tesla_links (user_id, access_token, refresh_token, expires_at, api_base, cars, vin)
    VALUES (${userId}, ${seal(tokens.access, secret())}, ${seal(tokens.refresh, secret())}, ${tokens.expiresAt},
            ${apiBase}, ${sql.json(cars as never)}, ${cars[0].vin})
    ON CONFLICT (user_id) DO UPDATE SET
      access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token, expires_at = EXCLUDED.expires_at,
      api_base = EXCLUDED.api_base, cars = EXCLUDED.cars, updated_at = now(),
      -- Keep the chosen car if it is still on the account; its last reading stays with it.
      vin = CASE WHEN tesla_links.vin IN (SELECT c->>'vin' FROM jsonb_array_elements(EXCLUDED.cars) c) THEN tesla_links.vin ELSE EXCLUDED.vin END,
      reading = CASE WHEN tesla_links.vin IN (SELECT c->>'vin' FROM jsonb_array_elements(EXCLUDED.cars) c) THEN tesla_links.reading ELSE NULL END,
      read_at = CASE WHEN tesla_links.vin IN (SELECT c->>'vin' FROM jsonb_array_elements(EXCLUDED.cars) c) THEN tesla_links.read_at ELSE NULL END`
  return 'connected'
}

/** Which of the driver's cars Mapic reads. */
export async function chooseTeslaCar(userId: string, vin: string): Promise<TeslaStatus | null> {
  const link = await loadLink(userId)
  if (!link) return NOT_CONNECTED
  if (!isVin(vin) || !link.cars.some((c) => c.vin === vin)) return null
  if (link.vin !== vin) {
    await sql`UPDATE tesla_links SET vin = ${vin}, reading = NULL, read_at = NULL, updated_at = now() WHERE user_id = ${userId}`
    link.vin = vin
    link.reading = null
  }
  return statusOf(link)
}

/* -------------------------------------------------------------------- read */

// One reading per driver at a time: Tesla's refresh tokens work once, so two
// requests refreshing together would cut the link. (In-memory: single instance.)
const inFlight = new Map<string, Promise<{ status: TeslaStatus; note: ReadNote }>>()

export function readTesla(userId: string): Promise<{ status: TeslaStatus; note: ReadNote }> {
  let job = inFlight.get(userId)
  if (!job) {
    job = read(userId).finally(() => inFlight.delete(userId))
    inFlight.set(userId, job)
  }
  return job
}

/** Tests only. */
export function resetTeslaReads() {
  inFlight.clear()
}

async function refresh(link: Link): Promise<boolean | 'gone'> {
  const tokens = await requestTokens({ grant_type: 'refresh_token', refresh_token: link.refresh }, link.refresh)
  if (tokens === 'refused') {
    // The driver removed Mapic in their Tesla account, or the link expired after months unused.
    await unlinkTesla(link.userId)
    return 'gone'
  }
  if (tokens === 'failed') return false
  await saveTokens(link.userId, tokens)
  Object.assign(link, tokens)
  return true
}

async function read(userId: string): Promise<{ status: TeslaStatus; note: ReadNote }> {
  const link = await loadLink(userId)
  if (!link) return { status: NOT_CONNECTED, note: null }
  if (!link.vin) return { status: statusOf(link), note: 'unavailable' }
  if (link.readAt && Date.now() - link.readAt.getTime() < MIN_READ_GAP_MS) return { status: statusOf(link), note: null }
  if (link.readsToday >= config.tesla.dailyReads) return { status: statusOf(link), note: 'limit' }

  if (link.expiresAt.getTime() - Date.now() < 60_000) {
    const ok = await refresh(link)
    if (ok === 'gone') return { status: NOT_CONNECTED, note: null }
    if (!ok) return { status: statusOf(link), note: 'unavailable' }
  }

  const path = `/api/1/vehicles/${link.vin}/vehicle_data?endpoints=charge_state`
  let res = await apiGet(link.apiBase, path, link.access)
  if (res.status === 401) {
    const ok = await refresh(link)
    if (ok === 'gone') return { status: NOT_CONNECTED, note: null }
    if (ok) res = await apiGet(link.apiBase, path, link.access)
  } else if (res.status === 421) {
    // Wrong region for this account (e.g. the driver moved): look it up again.
    const base = await regionBase(link.access)
    if (base !== link.apiBase) {
      link.apiBase = base
      await sql`UPDATE tesla_links SET api_base = ${base} WHERE user_id = ${userId}`
      res = await apiGet(base, path, link.access)
    }
  }

  let reading: TeslaReading | null = null
  let note: ReadNote = null
  if (res.status === 200) {
    reading = parseReading(res.json, true)
    if (!reading) note = 'unavailable'
  } else if (res.status === 408) {
    // Asleep or out of coverage. Never wake it for this: show what it last reported.
    note = 'asleep'
    const cached = await apiGet(link.apiBase, `/api/1/vehicles/${link.vin}/vehicle_data_cached`, link.access)
    if (cached.status === 200) reading = parseReading(cached.json, false)
  } else {
    note = 'unavailable'
    if (res.status) console.warn(`[tesla] vehicle_data returned ${res.status}`)
  }

  // Count every attempt Tesla answered: answers below 500 are billed, asleep ones included.
  const billed = res.status > 0 && res.status < 500
  if (reading) link.reading = reading
  await sql`
    UPDATE tesla_links SET
      reading = ${link.reading ? sql.json(link.reading as never) : null},
      read_at = now(),
      reads_count = CASE WHEN reads_day = (now() AT TIME ZONE 'utc')::date THEN reads_count ELSE 0 END + ${billed ? 1 : 0},
      reads_day = (now() AT TIME ZONE 'utc')::date
    WHERE user_id = ${userId}`
  return { status: statusOf(link), note }
}
