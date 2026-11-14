/**
 * Traffic along the route: which stretches are free, slow or jammed, so the route
 * line can be drawn in traffic colours. Pure functions, tested on their own.
 *
 * Traffic data comes as lines, one per direction of each road. A stretch of the
 * route takes the level of the traffic line it runs along: close to it and pointing
 * the same way (so the opposite carriageway's jam doesn't colour our side).
 * Where no traffic line matches, the level is unknown and the route keeps its own colour.
 */
import { bearing, distance, lerpLngLat, type LngLat } from '../lib/geo'

export type Congestion = 'low' | 'moderate' | 'heavy' | 'severe'

/** One direction of a road with its traffic level. Drawn in the direction of travel. */
export interface TrafficLine {
  coords: LngLat[]
  level: Congestion
}

/** A stretch of the route, by distance from its start, with one traffic level. */
export interface TrafficSpan {
  fromM: number
  toM: number
  level: Congestion
}

const LEVELS: Congestion[] = ['low', 'moderate', 'heavy', 'severe']
export const isCongestion = (v: unknown): v is Congestion => typeof v === 'string' && (LEVELS as string[]).includes(v)

/** The route is checked every this many metres. */
const STEP_M = 20
/** A traffic line counts when it is this close to the route… */
const NEAR_M = 14
/** …and points the same way within this many degrees. */
const SAME_WAY_DEG = 30
/** Unknown gaps shorter than this between two stretches of the same level are filled (junctions). */
const BRIDGE_M = 60
const CELL_M = 60

const M_PER_DEG_LAT = 111_320
const angle = (a: number, b: number) => Math.abs(((((b - a) % 360) + 540) % 360) - 180)

interface Piece {
  ax: number
  ay: number
  bx: number
  by: number
  bearing: number
  level: Congestion
}

/** A point may lie this far past the end of a traffic piece and still belong to it. */
const END_SLACK_M = 4

/**
 * Distance from a point to a piece of traffic line, in a flat local frame (metres).
 * Infinity when the point is beyond either end, so a jam's colour stops where the jam does.
 */
function toSegment(px: number, py: number, s: Piece) {
  const dx = s.bx - s.ax
  const dy = s.by - s.ay
  const len = Math.hypot(dx, dy)
  if (len === 0) return Infinity
  const along = ((px - s.ax) * dx + (py - s.ay) * dy) / len
  if (along < -END_SLACK_M || along > len + END_SLACK_M) return Infinity
  const t = Math.min(1, Math.max(0, along / len))
  return Math.hypot(px - (s.ax + dx * t), py - (s.ay + dy * t))
}

/**
 * The traffic level along a route, as stretches by distance. `cum` is the distance of
 * each route point from the start (as in Route.cum).
 */
export function routeTrafficSpans(route: { coords: LngLat[]; cum: number[] }, lines: TrafficLine[]): TrafficSpan[] {
  const { coords, cum } = route
  if (coords.length < 2 || !lines.length) return []
  // Flat local frame around the route's start: fine for the tens of kilometres a route covers.
  const [lon0, lat0] = coords[0]
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180)
  const X = (c: LngLat) => (c[0] - lon0) * mPerDegLon
  const Y = (c: LngLat) => (c[1] - lat0) * M_PER_DEG_LAT

  // Traffic pieces in a grid, so each route sample looks only at what is nearby.
  const grid = new Map<string, Piece[]>()
  for (const line of lines) {
    for (let i = 0; i + 1 < line.coords.length; i++) {
      const a = line.coords[i]
      const b = line.coords[i + 1]
      const piece: Piece = { ax: X(a), ay: Y(a), bx: X(b), by: Y(b), bearing: bearing(a, b), level: line.level }
      const len = Math.hypot(piece.bx - piece.ax, piece.by - piece.ay)
      if (len < 0.5) continue
      // Register the piece in every cell it passes through.
      const steps = Math.max(1, Math.ceil(len / (CELL_M / 2)))
      let last = ''
      for (let k = 0; k <= steps; k++) {
        const x = piece.ax + ((piece.bx - piece.ax) * k) / steps
        const y = piece.ay + ((piece.by - piece.ay) * k) / steps
        const key = `${Math.floor(x / CELL_M)},${Math.floor(y / CELL_M)}`
        if (key === last) continue
        last = key
        const cell = grid.get(key)
        if (cell) cell.push(piece)
        else grid.set(key, [piece])
      }
    }
  }

  const levelAt = (p: LngLat, heading: number): Congestion | null => {
    const px = X(p)
    const py = Y(p)
    const cx = Math.floor(px / CELL_M)
    const cy = Math.floor(py / CELL_M)
    let best: Congestion | null = null
    let bestDist = NEAR_M
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const piece of grid.get(`${gx},${gy}`) ?? []) {
          if (angle(heading, piece.bearing) > SAME_WAY_DEG) continue
          const d = toSegment(px, py, piece)
          if (d < bestDist) {
            bestDist = d
            best = piece.level
          }
        }
      }
    }
    return best
  }

  // Sample the route every STEP_M, in the middle of each step.
  const spans: TrafficSpan[] = []
  const add = (fromM: number, toM: number, level: Congestion | null) => {
    if (!level || toM <= fromM) return
    const prev = spans[spans.length - 1]
    if (prev && prev.level === level && fromM - prev.toM <= BRIDGE_M) prev.toM = toM
    else spans.push({ fromM, toM, level })
  }
  for (let i = 0; i + 1 < coords.length; i++) {
    const a = coords[i]
    const b = coords[i + 1]
    const len = cum[i + 1] - cum[i]
    if (len < 0.5) continue
    const heading = bearing(a, b)
    const steps = Math.max(1, Math.round(len / STEP_M))
    for (let k = 0; k < steps; k++) {
      const level = levelAt(lerpLngLat(a, b, (k + 0.5) / steps), heading)
      add(cum[i] + (len * k) / steps, cum[i] + (len * (k + 1)) / steps, level)
    }
  }
  return spans
}

/** The route's line between two distances from its start. */
export function sliceRoute(route: { coords: LngLat[]; cum: number[] }, fromM: number, toM: number): LngLat[] {
  const { coords, cum } = route
  const total = cum[cum.length - 1] ?? 0
  const from = Math.min(Math.max(fromM, 0), total)
  const to = Math.min(Math.max(toM, 0), total)
  if (to <= from || coords.length < 2) return []
  const at = (m: number, i: number): LngLat => {
    const len = cum[i + 1] - cum[i]
    return len > 0 ? lerpLngLat(coords[i], coords[i + 1], (m - cum[i]) / len) : coords[i]
  }
  let i = 0
  while (i + 2 < coords.length && cum[i + 1] <= from) i++
  const out: LngLat[] = [at(from, i)]
  while (i + 1 < coords.length && cum[i + 1] < to) {
    out.push(coords[i + 1])
    i++
  }
  i = Math.min(i, coords.length - 2)
  out.push(at(to, i))
  return out
}

/** Map tile that contains a point at a zoom level. */
export function tileAt(c: LngLat, z: number): { x: number; y: number } {
  const n = 2 ** z
  const lat = (Math.max(-85.0511, Math.min(85.0511, c[1])) * Math.PI) / 180
  return {
    x: Math.min(n - 1, Math.max(0, Math.floor(((c[0] + 180) / 360) * n))),
    y: Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n))),
  }
}

/** The tiles a line passes through at a zoom level (checked every ~150 m). */
export function tilesAlong(coords: LngLat[], z: number): { z: number; x: number; y: number }[] {
  const seen = new Set<string>()
  const out: { z: number; x: number; y: number }[] = []
  const visit = (c: LngLat) => {
    const t = tileAt(c, z)
    const key = `${t.x}/${t.y}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ z, ...t })
  }
  for (let i = 0; i < coords.length; i++) {
    visit(coords[i])
    if (i + 1 < coords.length) {
      const steps = Math.ceil(distance(coords[i], coords[i + 1]) / 150)
      for (let k = 1; k < steps; k++) visit(lerpLngLat(coords[i], coords[i + 1], k / steps))
    }
  }
  return out
}

/**
 * The most detailed set of tiles that covers the route without asking for too many:
 * zoom 15 for trips across town, coarser for long drives.
 */
export function tilesForRoute(coords: LngLat[], maxTiles = 80): { z: number; x: number; y: number }[] {
  for (let z = 15; z > 11; z--) {
    const tiles = tilesAlong(coords, z)
    if (tiles.length <= maxTiles) return tiles
  }
  return tilesAlong(coords, 11)
}
