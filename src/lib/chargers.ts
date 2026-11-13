import { distance } from './geo'
import type { Charger, Place } from '../types'

export type ChargerFilter = 'all' | 'fast'

/** 50 kW and up counts as fast charging. */
export const FAST_KW = 50

/** Fast = known 50 kW+, or a DC station whose power isn't listed (DC is rarely below 50 kW). */
export function isFast(c: Charger) {
  return (c.maxKw ?? 0) >= FAST_KW || (c.maxKw == null && c.dc === true)
}

const kw = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} kW`

/** "120 kW DC", "22 kW AC", "DC fast charging" or null when nothing is known. */
export function powerLabel(c: Charger): string | null {
  if (c.maxKw != null) return `${kw(c.maxKw)}${c.dc === true ? ' DC' : c.dc === false ? ' AC' : ''}`
  if (c.dc === true) return 'DC fast charging'
  return null
}

/** One line for lists: "Team Energy · 22 kW AC · Type 2". */
export function chargerSummary(c: Charger): string {
  const operator = c.operator && c.operator !== c.name ? c.operator : null
  return [operator, powerLabel(c), c.connectors.slice(0, 2).join(', ')].filter(Boolean).join(' · ')
}

export function chargerToPlace(c: Charger): Place {
  return { id: c.id, name: c.name, address: chargerSummary(c), lon: c.lon, lat: c.lat, category: 'charging', charger: c }
}

export function filterChargers(list: Charger[], filter: ChargerFilter) {
  return filter === 'fast' ? list.filter(isFast) : list
}

/** Nearest stations first, with their straight-line distance. */
export function nearestChargers(list: Charger[], origin: { lon: number; lat: number }, filter: ChargerFilter, limit = 30) {
  return filterChargers(list, filter)
    .map((c) => ({ charger: c, meters: distance([origin.lon, origin.lat], [c.lon, c.lat]) }))
    .sort((a, b) => a.meters - b.meters)
    .slice(0, limit)
}
