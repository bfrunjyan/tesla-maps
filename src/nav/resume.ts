/**
 * Picks a trip back up after the page reloads mid-drive: the car's browser tab crashed,
 * was reloaded, or the screen went to sleep and came back with a fresh page.
 *
 * While guidance runs, the trip (destination, stops, fastest or shortest) is kept on the
 * device. On the next start, a trip that was still running in the last half hour, and
 * whose destination the car hasn't reached, is planned again from where the car is and
 * guidance carries on. A trip that ended normally is forgotten at once.
 */
import { distance } from '../lib/geo'
import { load, save } from '../lib/storage'
import { useStore, type NavState } from '../state/store'
import type { Place, Position } from '../types'
import type { RoutePreference } from '../services/routing'
import { stopsOf } from './stops'

const KEY = 'activeTrip'
/** Older than this, it is a new day's drive, not a crash. */
export const RESUME_WITHIN_MS = 30 * 60_000
/** This close to the destination, the trip is as good as done. */
export const ALREADY_THERE_M = 150
/** Refreshed this often while driving, so "how long ago" stays true. */
const KEEP_FRESH_MS = 60_000
/** How long to wait for a real GPS fix before planning from wherever the map is. */
const WAIT_FOR_GPS_MS = 10_000

export interface SavedTrip {
  stops: Place[]
  preference: RoutePreference
  /** When guidance was last known to be running (ms). */
  at: number
}

const guiding = (nav: NavState | null) => nav?.status === 'active' || nav?.status === 'rerouting'

/** Whether a saved trip should be picked up now. */
export function shouldResume(saved: SavedTrip | null, now: number, position: Pick<Position, 'lon' | 'lat'> | null): saved is SavedTrip {
  if (!saved?.stops?.length || typeof saved.at !== 'number') return false
  if (now - saved.at > RESUME_WITHIN_MS || saved.at > now + 60_000) return false
  const dest = saved.stops[saved.stops.length - 1]
  if (position && distance([position.lon, position.lat], [dest.lon, dest.lat]) < ALREADY_THERE_M) return false
  return true
}

let lastSavedAt = 0
let lastKey = ''
let remembering = false
let resumeChecked = false

/** Keeps the running trip on the device, and forgets it when the trip ends. Safe to call twice. */
export function rememberTrips() {
  if (remembering) return
  remembering = true
  useStore.subscribe((s, prev) => {
    if (s.nav === prev.nav) return
    if (!s.nav || s.nav.status === 'arrived') {
      if (prev.nav) save(KEY, null)
      lastKey = ''
      return
    }
    if (!guiding(s.nav)) return
    const stops = stopsOf(s.nav)
    const key = stops.map((p) => `${p.lon},${p.lat}`).join('|')
    const now = Date.now()
    if (key === lastKey && now - lastSavedAt < KEEP_FRESH_MS) return
    lastKey = key
    lastSavedAt = now
    save(KEY, { stops, preference: s.nav.route?.preference ?? 'fastest', at: now } satisfies SavedTrip)
  })
}

/**
 * At start: if a trip was cut short, plan it again from where the car is and carry on.
 * `resume` does the planning (the controller's resumeTrip); it is passed in to keep this
 * file free of the controller.
 */
export function resumeIfInterrupted(resume: (stops: Place[], preference: RoutePreference) => Promise<void>) {
  if (resumeChecked) return
  resumeChecked = true
  const saved = load<SavedTrip | null>(KEY, null)
  if (!saved) return
  const go = () => {
    const s = useStore.getState()
    if (s.nav) return // the driver already started something else
    if (!shouldResume(saved, Date.now(), s.position)) return save(KEY, null)
    const dest = saved.stops[saved.stops.length - 1]
    s.showToast(`Picking up your trip to ${dest.name}`)
    void resume(saved.stops, saved.preference)
  }
  // Plan from the car's real position: wait for the first GPS fix, but not for ever.
  if (useStore.getState().positionSource === 'gps') return go()
  const timer = window.setTimeout(() => {
    unsub()
    go()
  }, WAIT_FOR_GPS_MS)
  const unsub = useStore.subscribe((s) => {
    if (s.positionSource !== 'gps') return
    window.clearTimeout(timer)
    unsub()
    go()
  })
}
