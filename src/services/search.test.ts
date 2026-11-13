import { describe, expect, it } from 'vitest'
import type { Place } from '../types'
import { mergeResults, nearbyBox, NEARBY_KM } from './search'

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
