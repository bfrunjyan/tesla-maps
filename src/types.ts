import type { LngLat } from './lib/geo'

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
  source: 'osm' | 'ocm'
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
