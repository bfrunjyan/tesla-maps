/**
 * Place search. Prototype providers: Photon (text search, reverse geocoding)
 * and Overpass (category lists). Both are free public servers meant for light
 * use; swap this module for a licensed provider before launch.
 */
import type { Place, PlaceCategory } from '../types'

const PHOTON = 'https://photon.komoot.io'
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]

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
  const streetLine = [p.street, p.housenumber].filter(Boolean).join(' ')
  const name = p.name || streetLine || p.district || p.city || 'Unnamed place'
  const area = [p.district, p.city ?? p.locality].filter((x, i, a) => x && a.indexOf(x) === i)
  const address = [p.name ? streetLine : '', ...area].filter(Boolean).join(', ') || p.country || ''
  return {
    id: `${p.osm_type ?? 'X'}${p.osm_id ?? Math.random()}`,
    name,
    address,
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    category: categoryOf(p.osm_key, p.osm_value),
  }
}

export async function searchPlaces(q: string, near: { lon: number; lat: number }, signal?: AbortSignal): Promise<Place[]> {
  const url = new URL(`${PHOTON}/api/`)
  url.searchParams.set('q', q)
  url.searchParams.set('lat', String(near.lat))
  url.searchParams.set('lon', String(near.lon))
  url.searchParams.set('limit', '12')
  url.searchParams.set('location_bias_scale', '0.4')
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Search failed (${res.status})`)
  const data = await res.json()
  const seen = new Set<string>()
  return (data.features ?? []).map(photonToPlace).filter((p: Place) => {
    const k = `${p.name}|${p.address}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
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

export type CategoryKind = 'charging' | 'hungry' | 'lucky'

const CATEGORY_QUERY: Record<CategoryKind, string> = {
  charging: 'nwr["amenity"="charging_station"]',
  hungry: 'nwr["amenity"~"^(restaurant|fast_food|cafe)$"]["name"]',
  lucky: 'nwr["tourism"~"^(attraction|viewpoint|museum|artwork)$"]["name"]',
}

export async function categorySearch(kind: CategoryKind, near: { lon: number; lat: number }, signal?: AbortSignal): Promise<Place[]> {
  const radius = kind === 'hungry' ? 2500 : 15000
  const body = `[out:json][timeout:20];${CATEGORY_QUERY[kind]}(around:${radius},${near.lat},${near.lon});out center 60;`
  let lastError: unknown
  for (const endpoint of OVERPASS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: new URLSearchParams({ data: body }),
        signal,
      })
      if (!res.ok) throw new Error(`Overpass ${res.status}`)
      const data = await res.json()
      const places: Place[] = (data.elements ?? [])
        .map((e: { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }) => {
          const lat = e.lat ?? e.center?.lat
          const lon = e.lon ?? e.center?.lon
          if (lat == null || lon == null) return null
          const t = e.tags ?? {}
          const name = t.name || t['name:en'] || t.operator || t.brand || (kind === 'charging' ? 'Charging station' : 'Unnamed')
          const address = [t['addr:street'] && `${t['addr:street']} ${t['addr:housenumber'] ?? ''}`.trim(), t.operator && t.operator !== name ? t.operator : '', t.cuisine?.replace(/;/g, ', ')]
            .filter(Boolean)
            .join(' · ')
          return {
            id: `${e.type[0].toUpperCase()}${e.id}`,
            name,
            address,
            lon,
            lat,
            category: kind === 'charging' ? 'charging' : kind === 'hungry' ? 'food' : 'attraction',
          } satisfies Place
        })
        .filter(Boolean)
      return places
    } catch (err) {
      if (signal?.aborted) throw err
      lastError = err
    }
  }
  throw lastError ?? new Error('Category search failed')
}
