/**
 * Turns Tesla Fleet API responses into the small shapes Mapic uses. Pure functions:
 * everything here is tested without a network.
 */

/** A car on the driver's Tesla account. `model` matches the ids in src/vehicle/catalog.ts. */
export interface TeslaCar {
  vin: string
  name: string
  model: string | null
  year: number | null
}

export type ChargingState = 'charging' | 'complete' | 'stopped' | 'unplugged' | 'unknown'

export interface TeslaReading {
  /** Charge level in percent, as the car shows it. */
  pct: number
  /** Rated range in km; null when the car didn't report it. */
  rangeKm: number | null
  charging: ChargingState
  /** Minutes until charging finishes (only while charging). */
  minutesToFull: number | null
  /** The charge limit set in the car, percent. */
  limitPct: number | null
  /** Charging power in kW (only while charging). */
  powerKw: number | null
  /** When the car reported these values (ISO time). */
  at: string
  /** False when the car was asleep and Tesla returned its last report instead. */
  live: boolean
}

const KM_PER_MILE = 1.609344
const VIN = /^[A-HJ-NPR-Z0-9]{17}$/

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export const isVin = (v: unknown): v is string => typeof v === 'string' && VIN.test(v)

const VIN_MODELS: Record<string, string> = { S: 'models', '3': 'model3', X: 'modelx', Y: 'modely', C: 'cybertruck' }
// Position 10 of a VIN is the model year (letters I, O, Q, U and Z are never used).
const VIN_YEARS = 'ABCDEFGHJKLMNPRSTVWXY'

/** Model and model year from a Tesla VIN (position 4 is the model, position 10 the year). */
export function decodeVin(vin: string): { model: string | null; year: number | null } {
  if (!isVin(vin)) return { model: null, year: null }
  const i = VIN_YEARS.indexOf(vin[9])
  return { model: VIN_MODELS[vin[3]] ?? null, year: i >= 0 ? 2010 + i : null }
}

/** The cars in a `GET /api/1/vehicles` response. */
export function parseCars(json: unknown): TeslaCar[] {
  const list = obj(json).response
  if (!Array.isArray(list)) return []
  const cars: TeslaCar[] = []
  for (const item of list) {
    const v = obj(item)
    if (!isVin(v.vin)) continue
    const name = typeof v.display_name === 'string' ? v.display_name.trim().slice(0, 60) : ''
    cars.push({ vin: v.vin, name, ...decodeVin(v.vin) })
  }
  return cars
}

function chargingState(v: unknown): ChargingState {
  switch (v) {
    case 'Charging':
    case 'Starting':
      return 'charging'
    case 'Complete':
      return 'complete'
    case 'Stopped':
    case 'NoPower':
      return 'stopped'
    case 'Disconnected':
      return 'unplugged'
    default:
      return 'unknown'
  }
}

/**
 * The battery reading in a `vehicle_data` (or `vehicle_data_cached`) response.
 * Returns null when the response carries no charge level.
 */
export function parseReading(json: unknown, live: boolean, now = Date.now()): TeslaReading | null {
  const cs = obj(obj(obj(json).response).charge_state)
  // The car's own display uses the usable level (lower than the raw one when the battery is cold).
  const pct = num(cs.usable_battery_level) ?? num(cs.battery_level)
  if (pct == null || pct < 0 || pct > 100) return null
  const charging = chargingState(cs.charging_state)
  const miles = num(cs.battery_range)
  const minutes = num(cs.minutes_to_full_charge)
  const power = num(cs.charger_power)
  const limit = num(cs.charge_limit_soc)
  const ts = num(cs.timestamp)
  // Trust the car's timestamp unless it's missing or in the future.
  const at = ts != null && ts > 0 && ts <= now + 60_000 ? ts : now
  return {
    pct: Math.round(pct),
    rangeKm: miles != null && miles >= 0 ? Math.round(miles * KM_PER_MILE) : null,
    charging,
    minutesToFull: charging === 'charging' && minutes != null && minutes > 0 ? Math.round(minutes) : null,
    limitPct: limit != null && limit > 0 && limit <= 100 ? Math.round(limit) : null,
    powerKw: charging === 'charging' && power != null && power > 0 ? Math.round(power) : null,
    at: new Date(at).toISOString(),
    live,
  }
}

/** Only Tesla's own Fleet API hosts (or the configured stand-in) may receive a driver's token. */
export function isFleetApiBase(url: unknown, configured: string): url is string {
  if (typeof url !== 'string') return false
  try {
    const u = new URL(url)
    if (u.origin === new URL(configured).origin) return true
    return u.protocol === 'https:' && /^fleet-api\.prd\.[a-z]{2}\.vn\.cloud\.tesla\.(com|cn)$/.test(u.hostname)
  } catch {
    return false
  }
}
