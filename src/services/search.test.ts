import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Place } from '../types'
import { categorySearch, CATEGORY_RADIUS_KM, mergeResults, nearbyBox, NEARBY_KM, withinKm } from './search'

const YEREVAN = { lon: 44.5126, lat: 40.1777 }
const p = (name: string, lon: number, lat: number, address = ''): Place => ({ id: `${name}${lon}`, name, address, lon, lat })

describe('nearbyBox', () => {
  it('spans about 60 km each way around the car', () => {
    const [minLon, minLat, maxLon, maxLat] = nearbyBox(YEREVAN)
    expect((maxLat - minLat) * 111).toBeCloseTo(2 * NEARBY_KM, 0)
    expect((maxLon - minLon) * 111 * Math.cos((YEREVAN.lat * Math.PI) / 180)).toBeCloseTo(2 * NEARBY_KM, 0)
    expect(minLon).toBeLessThan(YEREVAN.lon)
    expect(maxLat).toBeGreaterThan(YEREVAN.lat)
  })
})

describe('mergeResults', () => {
  const cedarFalls = p('Music Station', -92.44, 42.53, 'Cedar Falls')
  const noumea = p('Music station', 166.45, -22.27, 'Nouméa')

  it('puts nearby matches first and far ones in a separate group', () => {
    const r = mergeResults([p('Music Land', 44.51, 40.18, 'Vazgen I')], [cedarFalls, noumea], YEREVAN)
    expect(r.nearby.map((x) => x.name)).toEqual(['Music Land'])
    expect(r.further.map((x) => x.address)).toEqual(['Cedar Falls', 'Nouméa'])
  })

  it('shows only "further away" results when nothing nearby matches', () => {
    const r = mergeResults([], [cedarFalls, noumea], YEREVAN)
    expect(r.nearby).toEqual([])
    expect(r.further).toHaveLength(2)
  })

  it('does not repeat a nearby place in the far group', () => {
    const cascade = p('Cascade', 44.515, 40.191, 'Tamanyan street')
    const r = mergeResults([cascade], [cascade, cedarFalls], YEREVAN)
    expect(r.further.map((x) => x.address)).toEqual(['Cedar Falls'])
  })

  it('drops the far group when there are plenty of nearby results', () => {
    const many = Array.from({ length: 9 }, (_, i) => p(`Cafe ${i}`, 44.5 + i / 1000, 40.18))
    expect(mergeResults(many, [cedarFalls], YEREVAN).further).toEqual([])
  })

  it('caps the far group at 5', () => {
    const far = Array.from({ length: 9 }, (_, i) => p(`Far ${i}`, 10 + i, 50))
    expect(mergeResults([], far, YEREVAN).further).toHaveLength(5)
  })
})

describe('nearby lists (I’m hungry, I’m feeling lucky)', () => {
  afterEach(() => vi.unstubAllGlobals())
  const feature = (name: string | undefined, lon: number, lat: number, key = 'amenity', value = 'restaurant') => ({
    properties: { osm_type: 'N', osm_id: Math.round(lon * 1e6), osm_key: key, osm_value: value, name, street: 'Abovyan street', housenumber: '5', city: 'Yerevan' },
    geometry: { coordinates: [lon, lat] },
  })

  it('asks Photon for the kind of place around the car and keeps named ones within reach', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ features: [feature('Chakavak', 44.515, 40.179), feature(undefined, 44.513, 40.178), feature('Far Cafe', 44.6, 40.3)] }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const places = await categorySearch('hungry', YEREVAN)
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]))
    expect(url.searchParams.get('include')).toBe('osm.amenity.restaurant,osm.amenity.cafe,osm.amenity.fast_food')
    expect(url.searchParams.get('lat')).toBe(String(YEREVAN.lat))
    expect(url.searchParams.has('q')).toBe(false)
    expect(places.map((x) => x.name)).toEqual(['Chakavak'])
    expect(places[0]).toMatchObject({ category: 'food', address: '5 Abovyan street, Yerevan' })
  })

  it('looks for sights for “lucky”, further out', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ features: [feature('Matenadaran', 44.52, 40.192, 'tourism', 'museum'), feature('Garni', 44.73, 40.11, 'tourism', 'attraction')] }) }))
    vi.stubGlobal('fetch', fetchMock)
    const places = await categorySearch('lucky', YEREVAN)
    expect(new URL(String((fetchMock.mock.calls[0] as unknown[])[0])).searchParams.get('include')).toContain('osm.tourism.museum')
    expect(places.map((x) => [x.name, x.category])).toEqual([['Matenadaran', 'attraction']]) // Garni is ~20 km away
  })

  it('gives up instead of loading forever when the server does not answer', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', (_url: string, init: { signal: AbortSignal }) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))))
    const result = categorySearch('hungry', YEREVAN).catch((e: Error) => e)
    await vi.advanceTimersByTimeAsync(8000)
    expect(await result).toBeInstanceOf(Error)
    vi.useRealTimers()
  })

  it('reaches 2.5 km for food and 15 km for sights', () => {
    expect(CATEGORY_RADIUS_KM).toEqual({ hungry: 2.5, lucky: 15 })
    expect(withinKm([p('A', 44.53, 40.1777), p('B', 44.6, 40.1777)], YEREVAN, 2.5).map((x) => x.name)).toEqual(['A'])
  })
})
