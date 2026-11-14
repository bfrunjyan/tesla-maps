/**
 * The lane bubble shown on the map at the next junction, like the car-navigation apps
 * drivers know: one arrow sign per lane, left to right, the lanes to take bright and
 * the rest dimmed. Shared by the standard and the Google map; each map only places it.
 */
import type { LngLat } from '../lib/geo'
import { upcomingLanes, type Lane, type LaneDir } from '../nav/lanes'
import type { NavProgress, Route } from '../types'

/* ------------------------------------------------------------ arrow drawing */

// Each lane sign is drawn in a 24 x 32 box: a stem rising from the bottom centre that
// bends towards where the lane goes. Left-hand signs are the right-hand ones mirrored.
const W = 24
const HEAD = 5.5

/** An arrowhead at (x, y) pointing at `deg` (0 = up, 90 = right). */
function head(x: number, y: number, deg: number): string {
  const r = (deg * Math.PI) / 180
  const tip = [x + Math.sin(r) * 1.5, y - Math.cos(r) * 1.5]
  const back = (a: number) => [x - Math.sin(r + a) * HEAD * 1.25, y + Math.cos(r + a) * HEAD * 1.25]
  const [l, rr] = [back(-0.6), back(0.6)]
  return `M${tip[0].toFixed(2)} ${tip[1].toFixed(2)}L${l[0].toFixed(2)} ${l[1].toFixed(2)}L${rr[0].toFixed(2)} ${rr[1].toFixed(2)}Z`
}

/** Stem path and arrowhead for one right-hand (or straight) direction. */
const RIGHT_SHAPES: Record<string, { stem: string; head: string }> = {
  through: { stem: 'M12 31V9', head: head(12, 6, 0) },
  'slight-right': { stem: 'M12 31V19L17.6 10.4', head: head(19, 8, 35) },
  right: { stem: 'M12 31V17Q12 12 17 12H18', head: head(21, 12, 90) },
  'sharp-right': { stem: 'M9 31V10L16.2 18.6', head: head(18.4, 21.2, 140) },
  'merge-right': { stem: 'M12 31V22Q12 17 16 14L18 12.5', head: head(20, 11, 50) },
  uturn: { stem: 'M15 31V13A4 4 0 0 0 7 13V19', head: head(7, 22, 180) },
}

function shapeFor(dir: LaneDir): { stem: string; head: string; mirror: boolean } {
  const mirror = dir.includes('left') && dir !== 'uturn'
  const key = dir === 'uturn' ? 'uturn' : (dir.replace('left', 'right') as keyof typeof RIGHT_SHAPES)
  return { ...RIGHT_SHAPES[key], mirror }
}

type Ink = 'bright' | 'soft' | 'dim'
const OPACITY: Record<Ink, number> = { bright: 1, soft: 0.72, dim: 0.34 }

/** One lane's sign as SVG: every direction painted on it, the one to follow on top. */
export function laneSvg(lane: Lane): string {
  const dirs = lane.dirs.length ? lane.dirs : (['through'] as LaneDir[])
  // The direction to follow is drawn last, so it sits above the others.
  const ordered = [...dirs.filter((d) => d !== lane.use), ...dirs.filter((d) => d === lane.use)]
  const ink = (d: LaneDir): Ink => (d === lane.use ? (lane.fit === 'best' ? 'bright' : lane.fit === 'ok' ? 'soft' : 'dim') : 'dim')
  const parts = ordered.map((d) => {
    const s = shapeFor(d)
    const o = OPACITY[ink(d)]
    const flip = s.mirror ? ` transform="matrix(-1 0 0 1 ${W} 0)"` : ''
    return `<g${flip} opacity="${o}"><path d="${s.stem}" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><path d="${s.head}" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></g>`
  })
  return `<svg class="lane__sign" viewBox="0 0 ${W} 32" width="${W}" height="32" aria-hidden="true">${parts.join('')}</svg>`
}

const WORDS: Record<LaneDir, string> = {
  uturn: 'U-turn',
  'sharp-left': 'sharp left',
  left: 'left',
  'slight-left': 'slight left',
  through: 'straight on',
  'slight-right': 'slight right',
  right: 'right',
  'sharp-right': 'sharp right',
  'merge-left': 'merge left',
  'merge-right': 'merge right',
}

/** What the bubble says to a screen reader: "Lanes: left (take), straight on, straight on or right". */
export function lanesLabel(lanes: Lane[]): string {
  return `Lanes: ${lanes.map((l) => `${(l.dirs.length ? l.dirs : (['through'] as LaneDir[])).map((d) => WORDS[d]).join(' or ')}${l.fit === 'best' ? ' (take)' : l.fit === 'ok' ? ' (also fine)' : ''}`).join(', ')}`
}

/** The bubble element: lanes in a row, with a pointer towards the junction on its right. */
export function laneCalloutElement(lanes: Lane[]): HTMLElement {
  // The map positions the outer element (with its own transform); the bubble inside animates.
  const anchor = document.createElement('div')
  anchor.className = 'lanes-anchor'
  const el = document.createElement('div')
  el.className = 'lanes'
  el.setAttribute('role', 'img')
  el.setAttribute('aria-label', lanesLabel(lanes))
  el.innerHTML = lanes.map((l) => `<span class="lane" data-fit="${l.fit}">${laneSvg(l)}</span>`).join('')
  anchor.appendChild(el)
  return anchor
}

/* ------------------------------------------------------------ showing it */

/** Whether turn-by-turn guidance is running (lanes are for driving, not the route preview). */
export const guiding = (nav: { status: string } | null | undefined) => nav?.status === 'active' || nav?.status === 'rerouting'

export interface LaneCalloutHost {
  /** Puts the bubble on the map with its pointer at `at`. */
  show: (el: HTMLElement, at: LngLat) => void
  hide: () => void
}

/**
 * Keeps the bubble in step with the drive: shown for the next junction that has lanes
 * once the car is close to it, gone after the turn or when the car leaves the route.
 */
export function createLaneCallout(host: LaneCalloutHost) {
  let shown: { route: Route; index: number } | null = null
  return function update(route: Route | null | undefined, progress: NavProgress | null | undefined) {
    const next = upcomingLanes(route, progress)
    if (!next) {
      if (shown) host.hide()
      shown = null
      return
    }
    if (shown && shown.route === route && shown.index === next.index) return
    shown = { route: route!, index: next.index }
    host.show(laneCalloutElement(next.lanes), next.at)
  }
}
