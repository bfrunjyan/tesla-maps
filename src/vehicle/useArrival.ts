import { arrivalPct, batteryLevel, type BatteryLevel } from '../nav/battery'
import { useStore } from '../state/store'
import type { Route } from '../types'
import { vehicleSpec } from './catalog'

export interface Arrival {
  /** Rounded percent; below 0 means the trip needs a charging stop. */
  pct: number
  level: BatteryLevel
  reachable: boolean
}

/**
 * Charge at arrival for a route, or null when the car, the battery level or the
 * route's energy estimate isn't known yet.
 */
export function useArrival(route: Route | null | undefined, remainingFrac = 1): Arrival | null {
  const vehicle = useStore((s) => s.vehicle)
  const battery = useStore((s) => s.battery)
  const spec = vehicleSpec(vehicle)
  if (!route || typeof route.kWh !== 'number' || !spec || !battery) return null
  const raw = arrivalPct({ pct: battery.pct, capacityKWh: spec.capacityKWh, factor: spec.factor, routeKWh: route.kWh, remainingFrac })
  const pct = Math.round(raw)
  return { pct, level: batteryLevel(raw), reachable: raw > 0 }
}
