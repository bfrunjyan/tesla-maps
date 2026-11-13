import { beforeEach, describe, expect, it } from 'vitest'
import type { TeslaLink, TeslaReading } from '../types'
import { NO_TESLA, useStore } from './store'

const reading = (pct: number, at: string, over: Partial<TeslaReading> = {}): TeslaReading => ({
  pct, rangeKm: 300, charging: 'unplugged', minutesToFull: null, limitPct: 80, powerKw: null, at, live: true, ...over,
})
const link = (r: TeslaReading | null): TeslaLink => ({
  enabled: true, connected: true, cars: [{ vin: '5YJYGDEE7NF123456', name: 'Aragats', model: 'modely', year: 2022 }], vin: '5YJYGDEE7NF123456', reading: r,
})
const s = () => useStore.getState()

beforeEach(() => useStore.setState({ battery: null, tesla: NO_TESLA, teslaNote: null }))

describe('battery level with a connected Tesla', () => {
  it('takes the level the car reported', () => {
    s().applyTesla(link(reading(72, '2026-11-14T10:00:00.000Z')))
    expect(s().battery).toEqual({ pct: 72, at: Date.parse('2026-11-14T10:00:00.000Z'), source: 'tesla' })
  })

  it('replaces a level set by hand', () => {
    s().setBattery(50)
    s().applyTesla(link(reading(72, '2026-11-14T10:00:00.000Z')))
    expect(s().battery).toMatchObject({ pct: 72, source: 'tesla' })
  })

  it('keeps Mapic’s running estimate when the same reading comes back', () => {
    s().applyTesla(link(reading(72, '2026-11-14T10:00:00.000Z')))
    s().drainBattery(3.5)
    s().applyTesla(link(reading(72, '2026-11-14T10:00:00.000Z')))
    expect(s().battery?.pct).toBeCloseTo(68.5)
  })

  it('moves to a newer reading, up or down', () => {
    s().applyTesla(link(reading(72, '2026-11-14T10:00:00.000Z')))
    s().drainBattery(3.5)
    s().applyTesla(link(reading(70, '2026-11-14T10:10:00.000Z')))
    expect(s().battery?.pct).toBe(70)
    s().applyTesla(link(reading(85, '2026-11-14T11:00:00.000Z', { charging: 'charging' })))
    expect(s().battery?.pct).toBe(85)
  })

  it('remembers why a reading is not live', () => {
    s().applyTesla(link(reading(72, '2026-11-14T07:00:00.000Z', { live: false })), 'asleep')
    expect(s().teslaNote).toBe('asleep')
    s().applyTesla(link(reading(71, '2026-11-14T10:00:00.000Z')))
    expect(s().teslaNote).toBeNull()
  })

  it('hands the level back to the driver after disconnecting', () => {
    s().applyTesla(link(reading(72, '2026-11-14T10:00:00.000Z')))
    s().applyTesla({ ...NO_TESLA, enabled: true })
    expect(s().battery).toMatchObject({ pct: 72, source: 'manual' })
    expect(s().tesla.connected).toBe(false)
  })

  it('leaves a hand-set level alone when nothing is connected', () => {
    s().setBattery(40)
    s().applyTesla({ ...NO_TESLA, enabled: true })
    expect(s().battery).toMatchObject({ pct: 40, source: 'manual' })
  })
})
