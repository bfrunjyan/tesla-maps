import { describe, expect, it } from 'vitest'
import type { Charger } from '../types'
import { mergeChargers, needsLoad, placeToCharger, type GooglePlace } from './googleChargers'

// Shaped like Google's answers around Republic Square (Nov 2026).
const evolt: GooglePlace = {
  id: 'ChIJevolt',
  displayName: { text: 'E-Volt Charging Station' },
  location: { latitude: 40.19, longitude: 44.52 },
  evChargeOptions: {
    connectorCount: 2,
    connectorAggregation: [
      { type: 'EV_CONNECTOR_TYPE_CCS_COMBO_2', maxChargeRateKw: 325, count: 1, availableCount: 1, availabilityLastUpdateTime: '2026-11-14T12:00:00Z' },
      { type: 'EV_CONNECTOR_TYPE_OTHER', count: 1, availableCount: 0, availabilityLastUpdateTime: '2026-11-14T12:01:00Z' },
    ],
  },
}
const teamEnergy: GooglePlace = {
  id: 'ChIJteam',
  displayName: { text: 'Team Energy Charging Station' },
  location: { latitude: 40.18, longitude: 44.51 },
  evChargeOptions: { connectorAggregation: [{ type: 'EV_CONNECTOR_TYPE_TYPE_2', maxChargeRateKw: 22, count: 1 }] },
}
const bare: GooglePlace = { id: 'ChIJeco', displayName: { text: 'EcoCars Charging Station' }, location: { latitude: 40.17, longitude: 44.5 } }

describe('Google stations as Mapic stations', () => {
  it('reads power, plugs, network and live availability', () => {
    expect(placeToCharger(evolt)).toEqual({
      id: 'google-ChIJevolt',
      name: 'E-Volt Charging Station',
      operator: 'E-Volt',
      lon: 44.52,
      lat: 40.19,
      maxKw: 325,
      dc: true,
      connectors: ['CCS2'],
      points: 2,
      source: 'google',
      status: { state: 'free', free: 1, total: 2, at: '2026-11-14T12:01:00Z' },
    })
  })

  it('knows an AC station from its plugs', () => {
    expect(placeToCharger(teamEnergy)).toMatchObject({ operator: 'Team Energy', maxKw: 22, dc: false, connectors: ['Type 2'], status: null })
  })

  it('keeps a station Google knows nothing more about', () => {
    expect(placeToCharger(bare)).toMatchObject({ operator: 'EcoCars', maxKw: null, dc: null, connectors: [], points: null })
    expect(placeToCharger({ id: 'x' })).toBeNull()
  })
})

describe('merging Google’s stations with Mapic’s', () => {
  const own = (id: string, lon: number, lat: number, maxKw: number | null): Charger => ({
    id, name: id, operator: null, lon, lat, maxKw, dc: null, connectors: [], points: null, source: 'osm', status: null,
  })
  const google = [placeToCharger(teamEnergy)!, placeToCharger(bare)!]

  it('lists a station both know once, keeping the one that knows the power', () => {
    const merged = mergeChargers([own('osm-same-as-eco', 44.5002, 40.1701, 50), own('osm-elsewhere', 44.6, 40.3, null)], google)
    expect(merged.map((c) => c.id).sort()).toEqual(['google-ChIJteam', 'osm-elsewhere', 'osm-same-as-eco'])
  })

  it('prefers Google’s entry when neither knows more', () => {
    const merged = mergeChargers([own('osm-team', 44.5101, 40.1801, null)], google)
    expect(merged.map((c) => c.id)).toEqual(['google-ChIJteam', 'google-ChIJeco'])
  })

  it('changes nothing without Google’s stations', () => {
    const list = [own('a', 44.5, 40.2, null)]
    expect(mergeChargers(list, [])).toBe(list)
  })
})

describe('which areas to ask Google about', () => {
  it('asks for a new area, and not again while inside one already loaded', () => {
    const done = [{ center: [44.51, 40.18] as [number, number], radiusM: 10_000, full: false }]
    expect(needsLoad([44.6, 40.3], 5_000, [])).toBe(true)
    expect(needsLoad([44.52, 40.185], 5_000, done)).toBe(false)
    expect(needsLoad([44.75, 40.18], 5_000, done)).toBe(true) // 20 km east
  })

  it('treats a full answer (20 stations, maybe more) as covering only near its centre', () => {
    const full = [{ center: [44.51, 40.18] as [number, number], radiusM: 10_000, full: true }]
    expect(needsLoad([44.51, 40.18], 4_000, full)).toBe(false)
    expect(needsLoad([44.56, 40.18], 4_000, full)).toBe(true) // ~4 km off centre
  })
})
