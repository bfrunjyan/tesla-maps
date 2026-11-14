/**
 * Place search. Prototype provider: Photon (text search, reverse geocoding and the
 * Hungry / Lucky category lists), a free public server meant for light use; swap
 * this module for a licensed provider before launch.
 */
import { streetLine } from '../lib/address'
import type { Place, PlaceCategory } from '../types'

const PHOTON = 'https://photon.komoot.io'

interface PhotonProps {
  osm_type?: string
  osm_id?: number
  osm_key?: string
  osm_value?: string
  name?: string
  housenumber?: string
  street?: string
  district?: string
  locality?: string
  city?: string
  state?: string
  country?: string
}

function categoryOf(key?: string, value?: string): PlaceCategory {
  if (value === 'charging_station') return 'charging'
  if (key === 'amenity' && ['restaurant', 'fast_food', 'cafe', 'bar', 'pub', 'food_court'].includes(value ?? '')) return 'food'
  if (key === 'tourism') return 'attraction'
  if (key === 'place' || key === 'highway' || key === 'building') return 'address'
  return 'poi'
}

function photonToPlace(f: { properties: PhotonProps; geometry: { coordinates: [number, number] } }): Place {
  const p = f.properties
  const street = streetLine(p.street, p.housenumber)
  const name = p.name || street || p.district || p.city || 'Unnamed place'
  const area = [p.district, p.city ?? p.locality].filter((x, i, a) => x && a.indexOf(x) === i)
  const address = [p.name ? street : '', ...area].filter(Boolean).join(', ') || p.country || ''
  return {
    id: `${p.osm_type ?? 'X'}${p.osm_id ?? Math.random()}`,
    name,
    address,
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    category: categoryOf(p.osm_key, p.osm_value),
  }
}

/** Search radius treated as "nearby" (km). */
export const NEARBY_KM = 60
const FURTHER_MAX = 5

/** Bounding box [minLon, minLat, maxLon, maxLat] about `km` around a point. */
export function nearbyBox(near: { lon: number; lat: number }, km = NEARBY_KM): [number, number, number, number] {
  const dLat = km / 111
  const dLon = km / (111 * Math.cos((near.lat * Math.PI) / 180))
  return [near.lon - dLon, near.lat - dLat, near.lon + dLon, near.lat + dLat]
}

/** Great-circle distance in km. */
function kmBetween(p: { lon: number; lat: number }, near: { lon: number; lat: number }) {
  const dLat = ((p.lat - near.lat) * Math.PI) / 180
  const dLon = ((p.lon - near.lon) * Math.PI) / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((near.lat * Math.PI) / 180) * Math.cos((p.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(a))
}

const placeKey = (p: Place) => `${p.name.toLowerCase()}|${p.address.toLowerCase()}`

function dedupe(list: Place[]) {
  const seen = new Set<string>()
  return list.filter((p) => !seen.has(placeKey(p)) && (seen.add(placeKey(p)), true))
}

/**
 * Nearby results first (in the provider's relevance order); results from elsewhere
 * go in a separate "Further away" group, only when there are few nearby, at most 5.
 */
export function mergeResults(local: Place[], global: Place[], near: { lon: number; lat: number }) {
  const nearby = dedupe(local)
  if (nearby.length >= 8) return { nearby, further: [] as Place[] }
  const taken = new Set(nearby.map(placeKey))
  const further = dedupe(global)
    .filter((p) => !taken.has(placeKey(p)) && kmBetween(p, near) > NEARBY_KM)
    .slice(0, FURTHER_MAX)
  return { nearby, further }
}

async function photon(params: Record<string, string>, signal?: AbortSignal, opts: { named?: boolean } = {}): Promise<Place[]> {
  const url = new URL(`${PHOTON}/api/`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Search failed (${res.status})`)
  const data = await res.json()
  const features: { properties: PhotonProps; geometry: { coordinates: [number, number] } }[] = data.features ?? []
  // Lists of places to go to skip nameless ones (a café without a name is just an address).
  return (opts.named ? features.filter((f) => f.properties?.name) : features).map(photonToPlace)
}

/** Searches the area around the car and, in parallel, everywhere (for "Further away"). */
export async function searchPlaces(q: string, near: { lon: number; lat: number }, signal?: AbortSignal) {
  const [local, global] = await Promise.allSettled([
    photon({ q, bbox: nearbyBox(near).join(','), limit: '12' }, signal),
    photon({ q, lat: String(near.lat), lon: String(near.lon), limit: '10' }, signal),
  ])
  if (local.status === 'rejected' && global.status === 'rejected') throw local.reason
  return mergeResults(local.status === 'fulfilled' ? local.value : [], global.status === 'fulfilled' ? global.value : [], near)
}

export async function reverseGeocode(lon: number, lat: number, signal?: AbortSignal): Promise<{ place: Place; area: string } | null> {
  const res = await fetch(`${PHOTON}/reverse?lat=${lat}&lon=${lon}&limit=1`, { signal })
  if (!res.ok) return null
  const data = await res.json()
  const f = data.features?.[0]
  if (!f) return null
  const p = f.properties as PhotonProps
  // Inside large squares the nearest feature can be the city itself, with no district/city fields.
  const area = [p.district, p.city ?? p.locality ?? p.state].filter(Boolean).join(', ') || p.name || p.country || ''
  const place = photonToPlace(f)
  return { place: { ...place, lon, lat }, area }
}

export type CategoryKind = 'hungry' | 'lucky'

/** OpenStreetMap categories behind each list (Photon names them osm.<key>.<value>). */
const CATEGORY_INCLUDE: Record<CategoryKind, string> = {
  hungry: 'osm.amenity.restaurant,osm.amenity.cafe,osm.amenity.fast_food',
  lucky: 'osm.tourism.attraction,osm.tourism.museum,osm.tourism.viewpoint,osm.tourism.artwork',
}
/** How far each list reaches. */
export const CATEGORY_RADIUS_KM: Record<CategoryKind, number> = { hungry: 2.5, lucky: 15 }
/** A list that hasn't come back by then is given up, so the spinner never runs forever. */
const CATEGORY_TIMEOUT_MS = 8000

/** `signal`, plus giving up after `ms`. */
function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new Error('Timed out')), ms)
  signal?.addEventListener('abort', () => ctrl.abort(signal.reason))
  ctrl.signal.addEventListener('abort', () => clearTimeout(timer))
  return ctrl.signal
}

/**
 * Named places of a kind around the car: places to eat ("I'm hungry") or things to see
 * ("I'm feeling lucky"). From Photon's category search, which answers in under a second;
 * the public Overpass servers used before were often down or took longer than a drive.
 */
export async function categorySearch(kind: CategoryKind, near: { lon: number; lat: number }, signal?: AbortSignal): Promise<Place[]> {
  const places = await photon({ include: CATEGORY_INCLUDE[kind], lat: String(near.lat), lon: String(near.lon), limit: '50' }, withTimeout(signal, CATEGORY_TIMEOUT_MS), { named: true })
  return withinKm(places, near, CATEGORY_RADIUS_KM[kind]).map((p) => ({ ...p, category: kind === 'hungry' ? 'food' : 'attraction' }))
}

/** Places no further than `km` from `near`. */
export function withinKm(places: Place[], near: { lon: number; lat: number }, km: number): Place[] {
  return places.filter((p) => kmBetween(p, near) <= km)
}
