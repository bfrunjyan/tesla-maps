import type { TeslaReading } from '../types'

/**
 * When Mapic asks the car for its battery (Connect Tesla), and how a reading is worded.
 * Pure functions. Tesla bills every reading and asks apps not to poll, so Mapic reads
 * when it matters and estimates in between (nav/controller.ts lowers the level as the car moves).
 */
export type ReadEvent = 'open' | 'route' | 'visible' | 'tick' | 'manual'

/** While driving or charging, check the car this often. */
export const READ_EVERY_MS = 10 * 60_000
/** A route was just planned: a reading this fresh is good enough for charge at arrival. */
const ROUTE_FRESH_MS = 2 * 60_000

export function shouldRead(o: {
  event: ReadEvent
  connected: boolean
  /** The page is on screen. */
  visible: boolean
  /** Since Mapic last asked the car (Infinity if never). */
  sinceLastMs: number
  moving: boolean
  charging: boolean
  navigating: boolean
}): boolean {
  if (!o.connected) return false
  if (o.event === 'manual') return true
  if (!o.visible) return false
  switch (o.event) {
    case 'open':
      return true
    case 'route':
      return o.sinceLastMs >= ROUTE_FRESH_MS
    case 'visible':
      return o.sinceLastMs >= READ_EVERY_MS
    case 'tick':
      // A parked, unplugged car's level doesn't change: no reason to ask.
      return o.sinceLastMs >= READ_EVERY_MS && (o.moving || o.charging || o.navigating)
  }
}

/** "35 min", "1 h 20 min", "2 h". */
export function duration(minutes: number) {
  const m = Math.max(1, Math.round(minutes))
  if (m < 60) return `${m} min`
  const rest = m % 60
  return rest ? `${Math.floor(m / 60)} h ${rest} min` : `${m / 60} h`
}

/** "just now", "12 min ago", "3 h ago", "2 days ago". */
export function ago(ms: number) {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 2) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

/** One line under the level: range, then what the charger is doing. */
export function readingLine(r: TeslaReading): string {
  const parts: string[] = []
  if (r.rangeKm != null) parts.push(`${r.rangeKm} km range`)
  if (r.charging === 'charging') {
    const to = r.limitPct != null ? ` to ${r.limitPct}%` : ''
    parts.push(r.minutesToFull != null ? `Charging, ${duration(r.minutesToFull)}${to}` : 'Charging')
  } else if (r.charging === 'complete') parts.push('Charging complete')
  else if (r.charging === 'stopped') parts.push('Plugged in, not charging')
  return parts.join(' · ')
}
