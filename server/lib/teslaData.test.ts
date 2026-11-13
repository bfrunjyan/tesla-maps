import { describe, expect, it } from 'vitest'
import { open, seal } from './secretBox.ts'
import { decodeVin, isFleetApiBase, parseCars, parseReading } from './teslaData.ts'

const NOW = Date.UTC(2026, 10, 14, 12)
const data = (charge_state: Record<string, unknown>) => ({ response: { charge_state } })

describe('reading the battery from Tesla’s answer', () => {
  it('reads level, range in km, charge limit and the time the car reported', () => {
    const r = parseReading(data({ battery_level: 73, usable_battery_level: 72, battery_range: 201.4, charging_state: 'Disconnected', charge_limit_soc: 80, timestamp: NOW - 5000 }), true, NOW)
    expect(r).toEqual({ pct: 72, rangeKm: 324, charging: 'unplugged', minutesToFull: null, limitPct: 80, powerKw: null, at: new Date(NOW - 5000).toISOString(), live: true })
  })

  it('shows the usable level, like the car does when the battery is cold', () => {
    expect(parseReading(data({ battery_level: 60, usable_battery_level: 55 }), true, NOW)?.pct).toBe(55)
    expect(parseReading(data({ battery_level: 60 }), true, NOW)?.pct).toBe(60)
  })

  it('reports minutes left and power only while charging', () => {
    const charging = parseReading(data({ battery_level: 40, charging_state: 'Charging', minutes_to_full_charge: 35, charger_power: 11 }), true, NOW)
    expect(charging).toMatchObject({ charging: 'charging', minutesToFull: 35, powerKw: 11 })
    const done = parseReading(data({ battery_level: 80, charging_state: 'Complete', minutes_to_full_charge: 0, charger_power: 0 }), true, NOW)
    expect(done).toMatchObject({ charging: 'complete', minutesToFull: null, powerKw: null })
  })

  it('maps every charging state Tesla sends, and unknown ones', () => {
    const state = (s: unknown) => parseReading(data({ battery_level: 50, charging_state: s }), true, NOW)?.charging
    expect(['Charging', 'Starting', 'Complete', 'Stopped', 'NoPower', 'Disconnected', 'Calibrating', undefined].map(state)).toEqual([
      'charging', 'charging', 'complete', 'stopped', 'stopped', 'unplugged', 'unknown', 'unknown',
    ])
  })

  it('returns nothing when there is no usable level', () => {
    expect(parseReading({ response: null }, true, NOW)).toBeNull()
    expect(parseReading(data({ battery_level: 140 }), true, NOW)).toBeNull()
    expect(parseReading(data({ battery_level: '72' }), true, NOW)).toBeNull()
    expect(parseReading('nonsense', true, NOW)).toBeNull()
  })

  it('uses the current time when the car’s timestamp is missing or in the future', () => {
    expect(parseReading(data({ battery_level: 50 }), false, NOW)).toMatchObject({ at: new Date(NOW).toISOString(), live: false })
    expect(parseReading(data({ battery_level: 50, timestamp: NOW + 3600_000 }), true, NOW)?.at).toBe(new Date(NOW).toISOString())
  })
})

describe('cars on the Tesla account', () => {
  it('reads model and year from the VIN', () => {
    expect(decodeVin('5YJYGDEE7NF123456')).toEqual({ model: 'modely', year: 2022 })
    expect(decodeVin('5YJ3E1EA8KF654321')).toEqual({ model: 'model3', year: 2019 })
    expect(decodeVin('5YJSA1E26HF000001')).toEqual({ model: 'models', year: 2017 })
    expect(decodeVin('7SAXCBE50PF000001')).toEqual({ model: 'modelx', year: 2023 })
    expect(decodeVin('LRW3E7FA4RC000001')).toEqual({ model: 'model3', year: 2024 })
    expect(decodeVin('XP7YGCEK0TB000001')).toEqual({ model: 'modely', year: 2026 })
  })

  it('gives no model or year for anything that is not a VIN', () => {
    expect(decodeVin('not-a-vin')).toEqual({ model: null, year: null })
    expect(decodeVin('5YJRE1A19A1000001')).toEqual({ model: null, year: 2010 })
  })

  it('lists cars and skips entries without a valid VIN', () => {
    const cars = parseCars({ response: [{ vin: '5YJYGDEE7NF123456', display_name: ' Aragats ' }, { vin: 'bad' }, { display_name: 'x' }, null] })
    expect(cars).toEqual([{ vin: '5YJYGDEE7NF123456', name: 'Aragats', model: 'modely', year: 2022 }])
    expect(parseCars({ response: null })).toEqual([])
    expect(parseCars(null)).toEqual([])
  })
})

describe('where a driver’s token may be sent', () => {
  const configured = 'https://fleet-api.prd.na.vn.cloud.tesla.com'
  it('accepts Tesla’s regional addresses', () => {
    expect(isFleetApiBase('https://fleet-api.prd.eu.vn.cloud.tesla.com', configured)).toBe(true)
    expect(isFleetApiBase('https://fleet-api.prd.cn.vn.cloud.tesla.cn', configured)).toBe(true)
  })
  it('refuses anything else', () => {
    expect(isFleetApiBase('https://fleet-api.prd.eu.vn.cloud.tesla.com.evil.example', configured)).toBe(false)
    expect(isFleetApiBase('http://fleet-api.prd.eu.vn.cloud.tesla.com', configured)).toBe(false)
    expect(isFleetApiBase('https://evil.example', configured)).toBe(false)
    expect(isFleetApiBase(undefined, configured)).toBe(false)
    expect(isFleetApiBase('not a url', configured)).toBe(false)
  })
})

describe('stored tokens', () => {
  it('are unreadable without the server secret and open again with it', () => {
    const sealed = seal('refresh-token-value', 'secret-a')
    expect(sealed).not.toContain('refresh-token-value')
    expect(open(sealed, 'secret-a')).toBe('refresh-token-value')
    expect(open(sealed, 'secret-b')).toBeNull()
  })
  it('seal differently each time and reject tampering', () => {
    const a = seal('same', 'k')
    expect(seal('same', 'k')).not.toBe(a)
    const parts = a.split('.')
    parts[3] = Buffer.from('other').toString('base64url')
    expect(open(parts.join('.'), 'k')).toBeNull()
    expect(open('garbage', 'k')).toBeNull()
  })
})
