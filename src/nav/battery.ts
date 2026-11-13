/**
 * Battery maths for "charge at arrival". Pure functions.
 * Route energy comes from nav/energy.ts (a Model Y-class estimate), scaled per car.
 */
export type BatteryLevel = 'ok' | 'low' | 'critical'

/** Like the car: amber under 20 %, red under 10 %. */
export function batteryLevel(pct: number): BatteryLevel {
  return pct < 10 ? 'critical' : pct < 20 ? 'low' : 'ok'
}

/** Percent of the battery that `wh` watt-hours represents. */
export function whToPct(wh: number, capacityKWh: number) {
  return capacityKWh > 0 ? (wh / (capacityKWh * 1000)) * 100 : 0
}

/**
 * Estimated charge on arrival, in percent (can be negative: the trip needs a charging stop).
 * `remainingFrac` is the share of the route still ahead (1 before starting).
 */
export function arrivalPct(o: { pct: number; capacityKWh: number; factor: number; routeKWh: number; remainingFrac: number }) {
  const neededWh = o.routeKWh * 1000 * o.factor * Math.min(1, Math.max(0, o.remainingFrac))
  return o.pct - whToPct(neededWh, o.capacityKWh)
}

export function clampPct(pct: number) {
  return Math.min(100, Math.max(0, pct))
}
