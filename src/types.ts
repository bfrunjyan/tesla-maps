import type { LngLat } from './lib/geo'
import type { Lane } from './nav/lanes'
import type { TrafficSpan } from './nav/routeTraffic'

export type PlaceCategory = 'address' | 'charging' | 'food' | 'attraction' | 'poi' | 'home' | 'work' | 'pin'

export interface Place {
  id: string
  name: string
  address: string
  lon: number
  lat: number
  category?: PlaceCategory
  /** Present for charging stations. */
  charger?: Charger
}

/** A charging station from the server's charger feed (see server/lib/chargerData.ts). */
export interface Charger {
  id: string
  name: string
  operator: string | null
  lon: number
  lat: number
  /** Highest connector power in kW; null when the source doesn't list it. */
  maxKw: number | null
  dc: boolean | null
  connectors: string[]
  points: number | null
  source: 'osm' | 'ocm' | 'google'
  /** Live availability; null until a charging network shares it. */
  status: { state: 'free' | 'busy' | 'offline'; free?: number; total?: number; at: string } | null
}

/** The driver's car: ids from src/vehicle/catalog.ts. */
export interface Vehicle {
  model: string
  year: number
  trim: string
}

export interface Battery {
  /** Percent, 0–100 (fractional while Mapic estimates it between corrections). */
  pct: number
  /** When it was last set or read. */
  at: number
  source: 'manual' | 'tesla'
}

/** A car on the driver's Tesla account (Connect Tesla). `model` is a catalog id when the VIN tells it. */
export interface TeslaCar {
  vin: string
  name: string
  model: string | null
  year: number | null
}

/** What the car last reported (see server/lib/teslaData.ts). */
export interface TeslaReading {
  pct: number
  rangeKm: number | null
  charging: 'charging' | 'complete' | 'stopped' | 'unplugged' | 'unknown'
  minutesToFull: number | null
  limitPct: number | null
  powerKw: number | null
  /** When the car reported it (ISO time). */
  at: string
  /** False when the car was asleep and this is its last report. */
  live: boolean
}

/** Why the newest reading isn't live. */
export type TeslaNote = 'asleep' | 'limit' | 'unavailable' | null

export interface TeslaLink {
  /** Whether this server offers Connect Tesla at all. */
  enabled: boolean
  connected: boolean
  cars: TeslaCar[]
  vin: string | null
  reading: TeslaReading | null
}

export interface Position {
  lon: number
  lat: number
  /** Degrees clockwise from north, or null when unknown (stationary). */
  heading: number | null
  /** m/s */
  speed: number
  accuracy: number
  ts: number
}

export interface Maneuver {
  type: number
  instruction: string
  verbalAlert?: string
  verbalPre?: string
  verbalPost?: string
  street: string
  /** Index into route.coords where the maneuver happens. */
  shapeIndex: number
  /** Distance from route start to the maneuver point, meters. */
  atM: number
  /** Length of the stretch that follows this maneuver, meters. */
  lengthM: number
  timeS: number
  /** The junction's lanes, left-most first, where the map data has them. */
  lanes?: Lane[]
}

export interface Route {
  coords: LngLat[]
  /** Cumulative distance along coords, meters. */
  cum: number[]
  maneuvers: Maneuver[]
  totalM: number
  totalS: number
  lang: string
  /** How it was planned, so rerouting keeps the driver's choice. */
  preference?: 'fastest' | 'shortest'
  climbM?: number
  descentM?: number
  /** Estimated battery use (see nav/energy.ts). */
  kWh?: number
  /**
   * The places the route was planned through, in order (the last is the destination):
   * where each one is along the route, and the maneuver that arrives at it.
   */
  stops?: RouteStop[]
  /** Traffic along the route as the routing service gave it (Google); otherwise read from traffic tiles. */
  traffic?: TrafficSpan[]
  /** Which service planned it. */
  source?: 'google'
}

export interface RouteStop {
  lon: number
  lat: number
  atM: number
  maneuverIndex: number
}

export interface NavProgress {
  /** Meters travelled along the route. */
  alongM: number
  /** Index of the segment the car is snapped to. */
  segIndex: number
  snapped: LngLat
  offRouteM: number
  nextIndex: number
  toNextM: number
  remainingM: number
  remainingS: number
}
