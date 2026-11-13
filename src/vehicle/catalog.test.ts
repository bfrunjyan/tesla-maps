import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { arrivalPct, batteryLevel, clampPct, whToPct } from '../nav/battery'
import { LATEST_YEAR, MODELS, findModel, trimsFor, vehicleSpec, yearsFor } from './catalog'

describe('car catalog', () => {
  it('has a photo file and a credit for every model', () => {
    for (const m of MODELS) {
      expect(existsSync(`public${m.image}`), m.image).toBe(true)
      expect(m.credit.author).toBeTruthy()
      expect(m.credit.license).toMatch(/^(CC BY-SA 4\.0|CC0)$/)
      expect(m.credit.url).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/)
    }
  })

  it('offers at least one version for every year of every model', () => {
    for (const m of MODELS) for (const y of yearsFor(m)) expect(trimsFor(m, y).length, `${m.name} ${y}`).toBeGreaterThan(0)
  })

  it('lists years newest first, from the first model year', () => {
    const years = yearsFor(findModel('modely')!)
    expect(years[0]).toBe(LATEST_YEAR)
    expect(years[years.length - 1]).toBe(2020)
  })

  it('only offers versions sold that year', () => {
    const m3 = findModel('model3')!
    expect(trimsFor(m3, 2017).map((t) => t.id)).toEqual(['lr'])
    expect(trimsFor(m3, 2024).map((t) => t.id)).toEqual(['rwd', 'lr', 'perf'])
    expect(trimsFor(findModel('models')!, 2023).map((t) => t.id)).toEqual(['lr', 'plaid'])
  })

  it('resolves a saved car, and returns null for an unknown one', () => {
    expect(vehicleSpec({ model: 'modely', year: 2023, trim: 'lr' })).toMatchObject({ title: '2023 Model Y', capacityKWh: 75, factor: 1 })
    expect(vehicleSpec({ model: 'roadster', year: 2010, trim: 'x' })).toBeNull()
    expect(vehicleSpec(null)).toBeNull()
  })
})

describe('battery maths', () => {
  it('converts energy to battery percent', () => {
    expect(whToPct(7500, 75)).toBeCloseTo(10)
  })

  it('estimates charge at arrival: 80 % minus an 18 kWh trip on a 75 kWh pack ≈ 56 %', () => {
    expect(arrivalPct({ pct: 80, capacityKWh: 75, factor: 1, routeKWh: 18, remainingFrac: 1 })).toBeCloseTo(56)
  })

  it('needs less as the trip progresses, and more for a heavier car', () => {
    const base = { pct: 80, capacityKWh: 75, routeKWh: 18 }
    expect(arrivalPct({ ...base, factor: 1, remainingFrac: 0.5 })).toBeCloseTo(68)
    expect(arrivalPct({ ...base, factor: 1.6, remainingFrac: 1 })).toBeLessThan(arrivalPct({ ...base, factor: 1, remainingFrac: 1 }))
  })

  it('goes negative when the trip needs a charging stop', () => {
    expect(arrivalPct({ pct: 10, capacityKWh: 57, factor: 1, routeKWh: 18, remainingFrac: 1 })).toBeLessThan(0)
  })

  it('warns like the car: amber under 20 %, red under 10 %', () => {
    expect(batteryLevel(35)).toBe('ok')
    expect(batteryLevel(19.9)).toBe('low')
    expect(batteryLevel(9)).toBe('critical')
    expect(clampPct(120)).toBe(100)
    expect(clampPct(-5)).toBe(0)
  })
})
