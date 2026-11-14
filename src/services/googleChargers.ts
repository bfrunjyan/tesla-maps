/**
 * Charging stations from Google (with the Google map only).
 *
 * Google lists far more stations in Armenia than OpenStreetMap (Team Energy, EcoCars,
 * Amperion, EVAN, E-Volt, iCHARGE…), though it gives the power for few of them. Google's
 * terms allow its place data only on a Google map, so these stations are fetched and
 * shown only while the Google map is on, and kept in memory for the session.
 *
 * Each request costs (Nearby Search "Enterprise + Atmosphere", $40 per 1,000 after
 * 1,000 free a month), so an area is asked for once: moving within an area already
 * loaded asks for nothing.
 */
import { useMemo } from 'react'
import { distance, type LngLat } from '../lib/geo'
import { useStore } from '../state/store'
import type { Charger } from '../types'
import { googleKey, usingGoogle } from './googleMaps'

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchNearby'
const FIELDS = 'places.id,places.displayName,places.location,places.formattedAddress,places.evChargeOptions'
/** Google returns at most 20 stations per request: the nearest ones. */
const PER_REQUEST = 20

export interface GooglePlace {
  id: string
  displayName?: { text?: string }
  location?: { latitude: number; longitude: number }
  formattedAddress?: string
  evChargeOptions?: {
    connectorCount?: number
    connectorAggregation?: {
      type?: string
      maxChargeRateKw?: number
      count?: number
      availableCount?: number
      outOfServiceCount?: number
      availabilityLastUpdateTime?: string
    }[]
  }
}

/** Google's connector types as drivers know them; DC ones say the station charges fast. */
const CONNECTORS: Record<string, { label: string; dc: boolean }> = {
  EV_CONNECTOR_TYPE_TYPE_2: { label: 'Type 2', dc: false },
  EV_CONNECTOR_TYPE_J1772: { label: 'Type 1', dc: false },
  EV_CONNECTOR_TYPE_CCS_COMBO_2: { label: 'CCS2', dc: true },
  EV_CONNECTOR_TYPE_CCS_COMBO_1: { label: 'CCS1', dc: true },
  EV_CONNECTOR_TYPE_CHADEMO: { label: 'CHAdeMO', dc: true },
  EV_CONNECTOR_TYPE_GB_T: { label: 'GB/T', dc: true },
  EV_CONNECTOR_TYPE_TESLA: { label: 'Tesla', dc: true },
  EV_CONNECTOR_TYPE_NACS: { label: 'NACS', dc: true },
}

/** "Team Energy Charging Station" → "Team Energy"; null when nothing is left. */
function operatorOf(name: string): string | null {
  const op = name.replace(/\s*(electric vehicle\s+)?(charging station|charging point|charger|charging)\s*$/i, '').trim()
  return op && op.toLowerCase() !== name.toLowerCase() ? op : null
}

/** One of Google's places as a Mapic charging station. */
export function placeToCharger(p: GooglePlace): Charger | null {
  if (!p.id || !p.location) return null
  const name = p.displayName?.text?.trim() || 'Charging station'
  const aggs = p.evChargeOptions?.connectorAggregation ?? []
  const kinds = aggs.map((a) => CONNECTORS[a.type ?? '']).filter(Boolean)
  const rates = aggs.map((a) => a.maxChargeRateKw ?? 0).filter((kw) => kw > 0)
  const total = aggs.reduce((n, a) => n + (a.count ?? 0), 0)
  const known = aggs.filter((a) => typeof a.availableCount === 'number')
  let status: Charger['status'] = null
  if (known.length) {
    const free = known.reduce((n, a) => n + (a.availableCount ?? 0), 0)
    const out = known.reduce((n, a) => n + (a.outOfServiceCount ?? 0), 0)
    const count = known.reduce((n, a) => n + (a.count ?? 0), 0)
    const at = known.map((a) => a.availabilityLastUpdateTime).filter(Boolean).sort().pop() ?? new Date().toISOString()
    status = { state: free > 0 ? 'free' : out >= count && count > 0 ? 'offline' : 'busy', free, total: count, at }
  }
  return {
    id: `google-${p.id}`,
    name,
    operator: operatorOf(name),
    lon: p.location.longitude,
    lat: p.location.latitude,
    maxKw: rates.length ? Math.max(...rates) : null,
    dc: kinds.some((k) => k.dc) ? true : kinds.length ? false : null,
    connectors: [...new Set(kinds.map((k) => k.label))],
    points: total || null,
    source: 'google',
    status,
  }
}

/** Stations within 60 m of each other are the same one. */
const SAME_STATION_M = 60

/**
 * Mapic's own stations plus Google's, each station once: where both list it, the entry
 * that knows the power wins (Google's on a tie, as it usually names the network).
 */
export function mergeChargers(own: Charger[], google: Charger[]): Charger[] {
  if (!google.length) return own
  const out = [...google]
  const at = (c: Charger): LngLat => [c.lon, c.lat]
  for (const c of own) {
    const i = out.findIndex((g) => g.source === 'google' && distance(at(g), at(c)) <= SAME_STATION_M)
    if (i < 0) out.push(c)
    else if (c.maxKw != null && out[i].maxKw == null) out[i] = { ...c, status: c.status ?? out[i].status }
  }
  return out
}

/** The stations to show: Mapic's own, and Google's too while the Google map is on. */
export function useShownChargers(): Charger[] {
  const own = useStore((s) => s.chargers)
  const google = useStore((s) => s.googleChargers)
  const on = useStore((s) => usingGoogle(s))
  return useMemo(() => (on ? mergeChargers(own, google) : own), [own, google, on])
}

let lastOwn: Charger[] | null = null
let lastGoogle: Charger[] | null = null
let lastMerged: Charger[] = []
/** The same as useShownChargers, outside React (the map). */
export function shownChargers(s: ReturnType<typeof useStore.getState>): Charger[] {
  if (!usingGoogle(s)) return s.chargers
  if (s.chargers !== lastOwn || s.googleChargers !== lastGoogle) {
    lastOwn = s.chargers
    lastGoogle = s.googleChargers
    lastMerged = mergeChargers(s.chargers, s.googleChargers)
  }
  return lastMerged
}

/* ------------------------------------------------------------ loading */

const loaded: { center: LngLat; radiusM: number; full: boolean }[] = []
let inFlight: AbortController | null = null

/**
 * Whether an area still needs asking for. A load that came back full (20 stations, so
 * there may be more) covers only half its circle; one that came back short covers it all.
 */
export function needsLoad(center: LngLat, radiusM: number, done: typeof loaded): boolean {
  return !done.some((l) => distance(l.center, center) + radiusM * 0.5 <= l.radiusM * (l.full ? 0.5 : 1))
}

/** Loads Google's stations around `center` (radius in metres), unless that area is already loaded. */
export async function loadGoogleChargers(center: LngLat, radiusM: number): Promise<void> {
  const key = googleKey()
  const radius = Math.min(50_000, Math.max(2_000, Math.round(radiusM)))
  if (!key || !needsLoad(center, radius, loaded)) return
  inFlight?.abort()
  const ctrl = (inFlight = new AbortController())
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS },
      body: JSON.stringify({
        includedTypes: ['electric_vehicle_charging_station'],
        maxResultCount: PER_REQUEST,
        rankPreference: 'DISTANCE',
        locationRestriction: { circle: { center: { latitude: center[1], longitude: center[0] }, radius } },
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`Google chargers ${res.status}`)
    const data = (await res.json()) as { places?: GooglePlace[] }
    const found = (data.places ?? []).map(placeToCharger).filter((c): c is Charger => !!c)
    loaded.push({ center, radiusM: radius, full: found.length >= PER_REQUEST })
    const byId = new Map(useStore.getState().googleChargers.map((c) => [c.id, c]))
    for (const c of found) byId.set(c.id, c)
    useStore.getState().set({ googleChargers: [...byId.values()] })
  } catch (err) {
    if (!ctrl.signal.aborted) console.warn('[google chargers]', err)
  }
}
