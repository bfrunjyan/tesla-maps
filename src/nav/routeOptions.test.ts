import { describe, expect, it } from 'vitest'
import type { Route } from '../types'
import { CLIMB_WH_PER_M, DESCENT_WH_PER_M, baseWhPerKm, climbStats, estimateKWh } from './energy'
import { buildOptions } from './routeOptions'

const route = (totalS: number, totalM: number, kWh?: number): Route => ({
  coords: [], cum: [], maneuvers: [], totalS, totalM, lang: 'en-US', kWh,
})

describe('energy estimate', () => {
  it('uses ~5.8 Wh per metre climbed and recovers ~3.1 Wh per metre descended', () => {
    expect(CLIMB_WH_PER_M).toBeCloseTo(5.75, 1)
    expect(DESCENT_WH_PER_M).toBeCloseTo(3.1, 1)
  })

  it('costs more per km at motorway speed than in town', () => {
    expect(baseWhPerKm(30)).toBeLessThan(150)
    expect(baseWhPerKm(90)).toBeGreaterThan(220)
  })

  it('estimates Yerevan → Lake Sevan (68 km, 1466 m up, 559 m down) at ~15–20 kWh', () => {
    const kWh = estimateKWh({ lengthKm: 68.3, timeS: 71 * 60, climbM: 1466, descentM: 559 })
    expect(kWh).toBeGreaterThan(15)
    expect(kWh).toBeLessThan(20)
  })

  it('makes the downhill direction cheaper than uphill', () => {
    const up = estimateKWh({ lengthKm: 68.3, timeS: 71 * 60, climbM: 1466, descentM: 559 })
    const down = estimateKWh({ lengthKm: 68.3, timeS: 71 * 60, climbM: 559, descentM: 1466 })
    expect(down).toBeLessThan(up)
  })

  it('sums climbs and descents, skipping missing height samples', () => {
    expect(climbStats([1000, 1010, null, 1005, 1030])).toEqual({ climbM: 35, descentM: 5 })
  })
})

describe('buildOptions', () => {
  it('orders fastest first and tags Fastest, Shortest and Economy', () => {
    const fast = route(22 * 60, 7010, 1.4)
    const alt = route(25 * 60, 7740, 1.2)
    const short = route(23 * 60, 6670, 1.3)
    const options = buildOptions([alt, fast, short])
    expect(options.map((o) => o.route)).toEqual([fast, short, alt])
    expect(options[0].tags).toEqual(['Fastest'])
    expect(options[1].tags).toEqual(['Shortest'])
    expect(options[2].tags).toEqual(['Economy'])
  })

  it('merges near-identical routes and lets one route carry several tags', () => {
    const best = route(21 * 60, 6600, 1.1)
    const sameAgain = route(21 * 60 + 10, 6620, 1.1)
    const options = buildOptions([best, sameAgain, route(26 * 60, 9000, 1.8)])
    expect(options).toHaveLength(2)
    expect(options[0].tags).toEqual(['Fastest', 'Shortest', 'Economy'])
  })

  it('treats a long trip’s near-identical routes as one (68.3 km vs 67.8 km, same time)', () => {
    const options = buildOptions([route(71 * 60, 68300, 18), route(71 * 60 + 20, 67800, 17.8)])
    expect(options).toHaveLength(1)
  })

  it('skips Economy when an energy estimate is missing', () => {
    const options = buildOptions([route(600, 5000, 1), route(700, 4000)])
    expect(options.flatMap((o) => o.tags)).not.toContain('Economy')
  })

  it('shows a single route with just the Fastest tag', () => {
    const options = buildOptions([route(71 * 60, 68300, 18)])
    expect(options).toHaveLength(1)
    expect(options[0].tags).toEqual(['Fastest'])
  })

  it('offers at most 3 choices', () => {
    const many = [1, 2, 3, 4, 5].map((i) => route(i * 300, 5000 + i * 500, 1))
    expect(buildOptions(many)).toHaveLength(3)
  })
})
