import { config } from '../config.ts'
import { sql } from '../db.ts'
import { mergeChargers, parseOcm, parseOsm, type Charger } from './chargerData.ts'

/**
 * Charger feed: all stations in the configured countries, refreshed twice a day and
 * served from memory. The car asks our server (one small, fast request) instead of
 * the public OpenStreetMap servers, which are often overloaded.
 */
const REFRESH_MS = 12 * 3600_000
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter']

export interface ChargerFeed {
  chargers: Charger[]
  updatedAt: string
  sources: string[]
}

let feed: ChargerFeed | null = null
let refreshing: Promise<void> | null = null

async function fetchOsm(): Promise<Charger[]> {
  const countries = config.chargers.countries.join('|')
  const query = `[out:json][timeout:60];area["ISO3166-1"~"^(${countries})$"]->.a;nwr(area.a)[amenity=charging_station];out tags center;`
  let lastError: unknown
  for (const endpoint of OVERPASS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'User-Agent': 'charger-sync/1.0' },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(90_000),
      })
      if (!res.ok) throw new Error(`Overpass ${res.status}`)
      const body = (await res.json()) as { elements?: Parameters<typeof parseOsm>[0] }
      return parseOsm(body.elements ?? [])
    } catch (err) {
      lastError = err
    }
  }
  throw lastError
}

async function fetchOcm(): Promise<Charger[]> {
  const out: Charger[] = []
  for (const country of config.chargers.countries) {
    const res = await fetch(`https://api.openchargemap.io/v3/poi?countrycode=${country}&maxresults=5000&compact=false&verbose=false`, {
      headers: { 'X-API-Key': config.chargers.ocmApiKey, 'User-Agent': 'charger-sync/1.0' },
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) throw new Error(`Open Charge Map ${res.status}`)
    out.push(...parseOcm((await res.json()) as Parameters<typeof parseOcm>[0]))
  }
  return out
}

async function refresh() {
  const jobs: [string, Promise<Charger[]>][] = [['OpenStreetMap', fetchOsm()]]
  if (config.chargers.ocmApiKey) jobs.push(['Open Charge Map', fetchOcm()])
  const results = await Promise.allSettled(jobs.map(([, p]) => p))
  const lists: Charger[][] = []
  const sources: string[] = []
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      lists.push(r.value)
      sources.push(jobs[i][0])
    } else {
      console.warn(`[chargers] ${jobs[i][0]} failed:`, r.reason instanceof Error ? r.reason.message : r.reason)
    }
  })
  if (!lists.length) return // keep the previous snapshot
  feed = { chargers: mergeChargers(...lists), updatedAt: new Date().toISOString(), sources }
  await sql`
    INSERT INTO charger_cache (id, data, fetched_at) VALUES (1, ${sql.json(feed as never)}, now())
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, fetched_at = now()`
  console.log(`[chargers] ${feed.chargers.length} stations from ${sources.join(' + ')}`)
}

function refreshInBackground() {
  refreshing ??= refresh()
    .catch((err) => console.warn('[chargers] refresh failed:', err))
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

export async function getChargerFeed(): Promise<ChargerFeed> {
  if (!feed) {
    const [row] = await sql<{ data: ChargerFeed }[]>`SELECT data FROM charger_cache WHERE id = 1`
    if (row) feed = row.data
  }
  const stale = !feed || Date.now() - Date.parse(feed.updatedAt) > REFRESH_MS
  if (!feed) await refreshInBackground() // first ever request waits for data
  else if (stale) void refreshInBackground()
  return feed ?? { chargers: [], updatedAt: new Date(0).toISOString(), sources: [] }
}

/** Tests only. */
export function resetChargerFeed() {
  feed = null
  refreshing = null
}
