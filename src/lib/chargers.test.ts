import { describe, expect, it } from 'vitest'
import type { Charger } from '../types'
import { chargerSummary, chargerToPlace, filterChargers, isFast, nearestChargers, powerLabel } from './chargers'

const charger = (over: Partial<Charger> = {}): Charger => ({
  id: 'c1', name: 'Dalma', operator: 'Team Energy', lon: 44.49, lat: 40.18, maxKw: null, dc: null, connectors: [], points: null, source: 'osm', status: null, ...over,
})

describe('isFast', () => {
  it('is 50 kW and up', () => {
    expect(isFast(charger({ maxKw: 49 }))).toBe(false)
    expect(isFast(charger({ maxKw: 50 }))).toBe(true)
    expect(isFast(charger({ maxKw: 240, dc: true }))).toBe(true)
  })

  it('counts DC stations with unlisted power, but not unknown ones', () => {
    expect(isFast(charger({ dc: true }))).toBe(true)
    expect(isFast(charger())).toBe(false)
    expect(isFast(charger({ maxKw: 22, dc: true }))).toBe(false)
  })
})

describe('labels', () => {
  it('describes power, or says nothing when it is unknown', () => {
    expect(powerLabel(charger({ maxKw: 22, dc: false }))).toBe('22 kW AC')
    expect(powerLabel(charger({ maxKw: 120, dc: true }))).toBe('120 kW DC')
    expect(powerLabel(charger({ maxKw: 7.4 }))).toBe('7.4 kW')
    expect(powerLabel(charger({ dc: true }))).toBe('DC fast charging')
    expect(powerLabel(charger())).toBeNull()
  })

  it('builds a one-line summary without repeating the name', () => {
    expect(chargerSummary(charger({ maxKw: 22, dc: false, connectors: ['Type 2', 'GB/T AC', 'CCS2'] }))).toBe('Team Energy · 22 kW AC · Type 2, GB/T AC')
    expect(chargerSummary(charger({ name: 'EnerGo', operator: 'EnerGo' }))).toBe('')
  })

  it('turns a charger into a place that keeps its details', () => {
    const place = chargerToPlace(charger({ maxKw: 22 }))
    expect(place).toMatchObject({ id: 'c1', name: 'Dalma', category: 'charging' })
    expect(place.charger?.maxKw).toBe(22)
  })
})

describe('filtering and distance', () => {
  const list = [
    charger({ id: 'far-fast', lat: 40.5, maxKw: 150 }),
    charger({ id: 'near-slow', lat: 40.181, maxKw: 22 }),
    charger({ id: 'mid-fast', lat: 40.2, maxKw: 60 }),
  ]

  it('filters to fast chargers', () => {
    expect(filterChargers(list, 'fast').map((c) => c.id)).toEqual(['far-fast', 'mid-fast'])
    expect(filterChargers(list, 'all')).toHaveLength(3)
  })

  it('sorts by distance from the car', () => {
    const origin = { lon: 44.49, lat: 40.18 }
    expect(nearestChargers(list, origin, 'all').map((n) => n.charger.id)).toEqual(['near-slow', 'mid-fast', 'far-fast'])
    expect(nearestChargers(list, origin, 'fast', 1).map((n) => n.charger.id)).toEqual(['mid-fast'])
  })
})
