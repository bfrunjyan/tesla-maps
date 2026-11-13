import { bearing, distance, type LngLat } from '../lib/geo'
import { cancelSpeech, setVoiceEnabled, speak } from '../lib/voice'
import { reverseGeocode } from '../services/search'
import { fetchRoute, fetchRouteOptions } from '../services/routing'
import { useStore } from '../state/store'
import type { NavProgress, Place, Position, Route } from '../types'
import { vehicleSpec } from '../vehicle/catalog'
import { whToPct } from './battery'
import { baseWhPerKm } from './energy'
import { angleDiff, rawHeading, smoothHeading } from './heading'
import { courseOf, createOffRouteDetector, maxAheadM } from './offRoute'
import { computeProgress } from './progress'

/** Republic Square, Yerevan: used until (or unless) the browser gives us a GPS fix. */
export const FALLBACK_CENTER = { lon: 44.5126, lat: 40.1777 }

const REROUTE_COOLDOWN_MS = 8000
/** A recalculation that takes longer than this is dropped, so the next one can start. */
const REROUTE_TIMEOUT_MS = 12_000
const ARRIVE_M = 25

let routeAbort: AbortController | null = null
const offRoute = createOffRouteDetector()
let lastRerouteAt = 0
let rerouteFailed = false
let spoken = new Set<string>()
let arrivedTimer: number | undefined

const get = () => useStore.getState()

/* ---------------------------------------------------------------- routing */

/** Picks a destination: fetch route choices and show the preview (fastest pre-selected). */
export async function startNavigation(dest: Place) {
  const s = get()
  const from = s.position ?? { ...FALLBACK_CENTER, heading: null }
  routeAbort?.abort()
  routeAbort = new AbortController()
  window.clearTimeout(arrivedTimer)
  s.addRecent(dest)
  s.set({
    nav: { destination: dest, route: null, progress: null, status: 'routing' },
    panelOpen: false,
    selectedPlace: null,
    query: '',
    follow: false,
    turnListOpen: false,
  })
  try {
    const options = await fetchRouteOptions(from, dest, s.lang, routeAbort.signal)
    if (!options.length) throw new Error('No route found')
    get().set({ nav: { destination: dest, route: null, progress: null, status: 'choosing', options, selected: 0 } })
  } catch (err) {
    if (routeAbort.signal.aborted) return
    const msg = err instanceof Error ? err.message : 'Routing failed'
    get().set({ nav: { destination: dest, route: null, progress: null, status: 'error', error: msg } })
  }
}

/** Highlights a route in the preview. */
export function selectRoute(index: number) {
  const nav = get().nav
  if (nav?.status === 'choosing' && nav.options?.[index]) get().set({ nav: { ...nav, selected: index } })
}

/** "Go": start guidance on the chosen route. */
export function goWithRoute(index?: number) {
  const nav = get().nav
  const option = nav?.options?.[index ?? nav.selected ?? 0]
  if (!nav || !option) return
  const s = get()
  const from = s.position ?? { ...FALLBACK_CENTER, heading: null }
  spoken = new Set()
  offRoute.reset()
  lastRerouteAt = 0
  rerouteFailed = false
  const route = option.route
  const progress = computeProgress(route, [from.lon, from.lat])
  s.set({ nav: { destination: nav.destination, route, progress, status: 'active' }, follow: true })
  speak(route.maneuvers[0]?.verbalPre, route.lang)
  spoken.add('0:pre')
}

export function endNavigation() {
  routeAbort?.abort()
  window.clearTimeout(arrivedTimer)
  cancelSpeech()
  get().set({ nav: null, turnListOpen: false })
}

/**
 * The driver left the route: plan a new one from where the car is, heading the way it
 * is actually moving, to the same destination. Guidance carries on with the old route
 * until the new one arrives.
 */
async function reroute(pos: Position, course: number | null) {
  const nav = get().nav
  if (!nav || nav.status === 'rerouting') return
  lastRerouteAt = Date.now()
  offRoute.reset()
  get().set({ nav: { ...nav, status: 'rerouting' } })
  routeAbort?.abort()
  const abort = new AbortController()
  routeAbort = abort
  // Never wait forever on a slow connection: a hung request would block every later recalculation.
  const timer = window.setTimeout(() => abort.abort(), REROUTE_TIMEOUT_MS)
  try {
    // Keep the driver's choice (fastest or shortest) when recalculating.
    const from = { lon: pos.lon, lat: pos.lat, heading: course ?? pos.heading }
    const route = await fetchRoute(from, nav.destination, get().lang, abort.signal, nav.route?.preference ?? 'fastest')
    const cur = get().nav
    if (!cur || routeAbort !== abort) return
    spoken = new Set()
    rerouteFailed = false
    // Match the car where it is now: it kept moving while the route was being planned.
    const now = get().position ?? pos
    const progress = computeProgress(route, [now.lon, now.lat])
    get().set({ nav: { ...cur, route, progress, status: 'active' } })
    speak(route.maneuvers[0]?.verbalPre, route.lang)
    spoken.add('0:pre')
  } catch {
    if (routeAbort !== abort) return // ended, or replaced by a newer request
    const cur = get().nav
    if (cur?.status === 'rerouting') get().set({ nav: { ...cur, status: 'active' } })
    // Still off the route: the detector fires again after the cooldown. Say so once.
    if (cur && !rerouteFailed) get().showToast('Couldn’t update the route. Trying again.')
    rerouteFailed = true
  } finally {
    window.clearTimeout(timer)
  }
}

/* --------------------------------------------------------------- position */

let lastArea: LngLat | null = null
let areaAbort: AbortController | null = null

let headingAnchor: LngLat | null = null

/* ------------------------------------------------------ battery estimate */

let pendingWh = 0

/**
 * Lowers the battery estimate as the car moves. On a route with an energy estimate
 * it uses the route's own figure (which includes climbs), so charge at arrival stays
 * steady; otherwise a flat-road estimate from speed.
 */
function trackBattery(prev: Position | null, pos: Position, route: Route | null, progress: NavProgress | null, lastProgress: NavProgress | null) {
  const s = get()
  const spec = vehicleSpec(s.vehicle)
  if (!spec || !s.battery || !prev) return
  const moved = distance([prev.lon, prev.lat], [pos.lon, pos.lat])
  if (moved < 1 || moved > 500) return // standing still, or a GPS jump
  const along = progress && lastProgress ? progress.alongM - lastProgress.alongM : 0
  const onRoute = route && typeof route.kWh === 'number' && progress && progress.offRouteM < 30 && along > 0
  const wh = onRoute
    ? route.kWh! * 1000 * (along / route.totalM)
    : (moved / 1000) * baseWhPerKm(pos.speed * 3.6)
  pendingWh += wh * spec.factor
  const deltaPct = whToPct(pendingWh, spec.capacityKWh)
  if (deltaPct >= 0.25) {
    pendingWh = 0
    s.drainBattery(deltaPct)
  }
}

export function onPosition(fix: Position, source: 'gps' | 'fallback' | 'sim') {
  const s = get()
  const prev = s.position
  const nav = s.nav
  const route = nav?.route && nav.status !== 'arrived' ? nav.route : null
  const here: LngLat = [fix.lon, fix.lat]
  // The direction the car is really moving, independent of the route.
  const before: LngLat | null = prev ? [prev.lon, prev.lat] : null
  const course = courseOf({
    gpsHeading: fix.heading,
    speed: fix.speed,
    moved: before ? distance(before, here) : 0,
    movedBearing: before ? bearing(before, here) : 0,
    accuracy: fix.accuracy,
  })
  // Match to the route: on route, the road's direction is the steadiest heading.
  const last = nav?.progress
  const progress = route
    ? computeProgress(route, here, last?.segIndex ?? 0, last?.alongM, maxAheadM(fix.speed, prev ? fix.ts - prev.ts : 1000, fix.accuracy))
    : null
  /** Direction of the route where the car is matched. */
  let segBearing: number | null = null
  if (route && progress) {
    const a = route.coords[progress.segIndex]
    const b = route.coords[Math.min(progress.segIndex + 1, route.coords.length - 1)]
    if (distance(a, b) > 1) segBearing = bearing(a, b)
  }
  // The road's direction steadies the arrow, but only while the car is going that way.
  const withRoute = segBearing != null && progress!.offRouteM < 20 && (course == null || Math.abs(angleDiff(segBearing, course)) < 90)
  const routeBearing = withRoute ? segBearing : null
  // Movement is measured from where the heading was last set, so a slow crawl
  // around a corner still adds up to a direction.
  headingAnchor ??= here
  const raw = rawHeading({
    gpsHeading: fix.heading,
    speed: fix.speed,
    moved: distance(headingAnchor, here),
    movedBearing: bearing(headingAnchor, here),
    accuracy: fix.accuracy,
    routeBearing,
  })
  if (raw != null) headingAnchor = here
  const pos = { ...fix, heading: smoothHeading(prev?.heading ?? null, raw, fix.speed) }
  s.set({ position: pos, positionSource: source })
  if (source !== 'fallback') trackBattery(prev, pos, route, progress, nav?.progress ?? null)
  updateAreaLabel(pos)

  if (!route || !progress || !nav) return

  if (progress.remainingM < ARRIVE_M) {
    s.set({ nav: { ...nav, progress, status: 'arrived' } })
    speak(route.maneuvers[route.maneuvers.length - 1]?.verbalPre ?? 'You have arrived', route.lang)
    arrivedTimer = window.setTimeout(() => {
      if (get().nav?.status === 'arrived') endNavigation()
    }, 10000)
    return
  }

  // Left the route (turned off it, drifted far from it, or driving it backwards)?
  if (source !== 'fallback' && nav.status !== 'rerouting') {
    const reason = offRoute.check({ ts: fix.ts, offRouteM: progress.offRouteM, accuracy: fix.accuracy, speed: fix.speed, course, routeBearing: segBearing })
    if (reason && Date.now() - lastRerouteAt > REROUTE_COOLDOWN_MS) {
      s.set({ nav: { ...nav, progress } })
      reroute(pos, course)
      return
    }
  }

  s.set({ nav: { ...nav, progress } })
  announce(progress.nextIndex, progress.toNextM, pos.speed)
}

function announce(index: number, toNextM: number, speed: number) {
  const nav = get().nav
  const m = nav?.route?.maneuvers[index]
  if (!nav?.route || !m) return
  const alertAt = Math.max(350, speed * 22)
  const preAt = Math.max(70, speed * 7)
  if (toNextM <= preAt && !spoken.has(`${index}:pre`)) {
    spoken.add(`${index}:pre`).add(`${index}:alert`)
    speak(m.verbalPre ?? m.instruction, nav.route.lang)
  } else if (toNextM <= alertAt && toNextM > preAt * 1.6 && !spoken.has(`${index}:alert`) && m.verbalAlert) {
    spoken.add(`${index}:alert`)
    speak(m.verbalAlert, nav.route.lang)
  }
}

function updateAreaLabel(pos: Position) {
  const here: LngLat = [pos.lon, pos.lat]
  if (lastArea && distance(lastArea, here) < 400) return
  lastArea = here
  areaAbort?.abort()
  areaAbort = new AbortController()
  reverseGeocode(pos.lon, pos.lat, areaAbort.signal)
    .then((r) => r?.area && get().set({ areaLabel: r.area }))
    .catch(() => {})
}

/* ------------------------------------------------------------- location */

const WEAK_ACCURACY_M = 50
const LOST_AFTER_MS = 12_000

let watchId: number | null = null
let lastFixAt = 0
let healthTimer: number | undefined

function showFallbackArea() {
  if (get().position) return
  onPosition({ ...FALLBACK_CENTER, heading: null, speed: 0, accuracy: 9999, ts: Date.now() }, 'fallback')
}

/**
 * Called once at startup. Checks the permission first so the driver sees why
 * Mapic needs location before the car's own "Allow" prompt appears.
 */
export async function initLocation() {
  if (!('geolocation' in navigator)) {
    get().set({ gps: 'unavailable' })
    return showFallbackArea()
  }
  let state: PermissionState | 'unknown' = 'unknown'
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' })
    state = status.state
    // Re-enabled in the browser's site settings: start right away.
    status.onchange = () => {
      if (status.state === 'granted') startWatching()
      if (status.state === 'denied') get().set({ gps: 'denied', locationSheetOpen: true })
    }
  } catch {
    /* Permissions API unavailable: just ask */
  }
  if (state === 'granted' || state === 'unknown') return startWatching()
  showFallbackArea()
  get().set({ gps: state === 'denied' ? 'denied' : 'needs-permission', locationSheetOpen: true })
}

/** Starts GPS. Call from a tap when possible (the "Allow location" button). */
export function startWatching() {
  if (watchId != null) return
  get().set({ gps: 'finding', locationSheetOpen: false })
  watchId = navigator.geolocation.watchPosition(
    (p) => {
      lastFixAt = Date.now()
      if (sim.running) return
      const h = p.coords.heading
      get().set({ gps: p.coords.accuracy > WEAK_ACCURACY_M ? 'weak' : 'ok' })
      onPosition(
        {
          lon: p.coords.longitude,
          lat: p.coords.latitude,
          heading: h != null && !Number.isNaN(h) ? h : null,
          speed: p.coords.speed ?? 0,
          accuracy: p.coords.accuracy,
          ts: p.timestamp,
        },
        'gps',
      )
    },
    (err) => {
      if (err.code === err.PERMISSION_DENIED) {
        if (watchId != null) navigator.geolocation.clearWatch(watchId)
        watchId = null
        get().set({ gps: 'denied', locationSheetOpen: true })
      } else if (!lastFixAt) {
        // No fix yet (no signal or timed out). The watch keeps trying.
        get().set({ gps: 'unavailable' })
      }
      showFallbackArea()
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
  )
  // A fix that stops arriving (tunnel, garage, browser throttling) shows as "lost".
  window.clearInterval(healthTimer)
  healthTimer = window.setInterval(() => {
    const { gps } = get()
    // Only while moving: browsers often stop sending updates when the position doesn't change,
    // so silence from a parked car (or a laptop on a desk) is normal, not a lost signal.
    const moving = (get().position?.speed ?? 0) > 1.5
    if ((gps === 'ok' || gps === 'weak') && moving && !sim.running && Date.now() - lastFixAt > LOST_AFTER_MS) get().set({ gps: 'lost' })
  }, 3000)
}

/** Driver chose "Not now": browse the map without GPS. */
export function skipLocation() {
  showFallbackArea()
  get().set({ locationSheetOpen: false })
}

/* ------------------------------------------- drive simulation (dev only) */

const sim = { running: false, timer: 0 as number | undefined, along: 0 }

export function isSimulating() {
  return sim.running
}

/** Drives along the active route at `kmh`, feeding positions like the GPS would. */
export function toggleSimulation(kmh = 45) {
  if (sim.running) {
    sim.running = false
    window.clearInterval(sim.timer)
    return false
  }
  const route = get().nav?.route
  if (!route) {
    get().showToast('Start a route first')
    return false
  }
  sim.running = true
  get().set({ gps: 'ok' })
  sim.along = get().nav?.progress?.alongM ?? 0
  const stepMs = 1000
  sim.timer = window.setInterval(() => {
    const r = get().nav?.route
    if (!r || !sim.running) {
      sim.running = false
      window.clearInterval(sim.timer)
      return
    }
    sim.along = Math.min(r.totalM, sim.along + (kmh / 3.6) * (stepMs / 1000))
    let i = r.cum.findIndex((c) => c > sim.along)
    if (i <= 0) i = r.cum.length - 1
    const a = r.coords[i - 1], b = r.coords[i]
    const seg = r.cum[i] - r.cum[i - 1]
    const t = seg > 0 ? (sim.along - r.cum[i - 1]) / seg : 1
    onPosition(
      { lon: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t, heading: bearing(a, b), speed: kmh / 3.6, accuracy: 5, ts: Date.now() },
      'sim',
    )
  }, stepMs)
  return true
}

useStore.subscribe((s, prev) => {
  if (s.voiceOn !== prev.voiceOn) setVoiceEnabled(s.voiceOn)
})
setVoiceEnabled(get().voiceOn)
