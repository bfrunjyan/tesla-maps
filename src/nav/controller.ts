import { bearing, distance, type LngLat } from '../lib/geo'
import { cancelSpeech, setVoiceEnabled, speak } from '../lib/voice'
import { reverseGeocode } from '../services/search'
import { fetchRoute } from '../services/routing'
import { useStore } from '../state/store'
import type { Place, Position } from '../types'
import { computeProgress } from './progress'

/** Republic Square, Yerevan: used until (or unless) the browser gives us a GPS fix. */
export const FALLBACK_CENTER = { lon: 44.5126, lat: 40.1777 }

const OFF_ROUTE_M = 45
const OFF_ROUTE_FIXES = 3
const REROUTE_COOLDOWN_MS = 8000
const ARRIVE_M = 25

let routeAbort: AbortController | null = null
let offRouteCount = 0
let lastRerouteAt = 0
let spoken = new Set<string>()
let arrivedTimer: number | undefined

const get = () => useStore.getState()

/* ---------------------------------------------------------------- routing */

export async function startNavigation(dest: Place) {
  const s = get()
  const from = s.position ?? { ...FALLBACK_CENTER, heading: null }
  routeAbort?.abort()
  routeAbort = new AbortController()
  window.clearTimeout(arrivedTimer)
  spoken = new Set()
  offRouteCount = 0
  s.addRecent(dest)
  s.set({
    nav: { destination: dest, route: null, progress: null, status: 'routing' },
    panelOpen: false,
    selectedPlace: null,
    query: '',
    follow: true,
    turnListOpen: false,
  })
  try {
    const route = await fetchRoute(from, dest, s.lang, routeAbort.signal)
    const progress = computeProgress(route, [from.lon, from.lat])
    get().set({ nav: { destination: dest, route, progress, status: 'active' } })
    speak(route.maneuvers[0]?.verbalPre, route.lang)
    spoken.add('0:pre')
  } catch (err) {
    if (routeAbort.signal.aborted) return
    const msg = err instanceof Error ? err.message : 'Routing failed'
    get().set({ nav: { destination: dest, route: null, progress: null, status: 'error', error: msg } })
  }
}

export function endNavigation() {
  routeAbort?.abort()
  window.clearTimeout(arrivedTimer)
  cancelSpeech()
  get().set({ nav: null, turnListOpen: false })
}

async function reroute(pos: Position) {
  const nav = get().nav
  if (!nav || nav.status === 'rerouting') return
  lastRerouteAt = Date.now()
  offRouteCount = 0
  get().set({ nav: { ...nav, status: 'rerouting' } })
  routeAbort?.abort()
  routeAbort = new AbortController()
  try {
    const route = await fetchRoute(pos, nav.destination, get().lang, routeAbort.signal)
    spoken = new Set()
    const progress = computeProgress(route, [pos.lon, pos.lat])
    const cur = get().nav
    if (!cur) return
    get().set({ nav: { ...cur, route, progress, status: 'active' } })
    speak(route.maneuvers[0]?.verbalPre, route.lang)
    spoken.add('0:pre')
  } catch {
    const cur = get().nav
    if (cur) get().set({ nav: { ...cur, status: 'active' } })
  }
}

/* --------------------------------------------------------------- position */

let lastArea: LngLat | null = null
let areaAbort: AbortController | null = null

export function onPosition(pos: Position, source: 'gps' | 'fallback' | 'sim') {
  const s = get()
  // Derive heading from movement when the device doesn't report one.
  const prev = s.position
  if (pos.heading == null && prev) {
    const moved = distance([prev.lon, prev.lat], [pos.lon, pos.lat])
    pos = { ...pos, heading: moved > 3 ? bearing([prev.lon, prev.lat], [pos.lon, pos.lat]) : prev.heading }
  }
  s.set({ position: pos, positionSource: source })
  updateAreaLabel(pos)

  const nav = s.nav
  if (!nav?.route || nav.status === 'arrived') return
  const route = nav.route
  const progress = computeProgress(route, [pos.lon, pos.lat], nav.progress?.segIndex ?? 0)

  if (progress.remainingM < ARRIVE_M) {
    s.set({ nav: { ...nav, progress, status: 'arrived' } })
    speak(route.maneuvers[route.maneuvers.length - 1]?.verbalPre ?? 'You have arrived', route.lang)
    arrivedTimer = window.setTimeout(() => {
      if (get().nav?.status === 'arrived') endNavigation()
    }, 10000)
    return
  }

  // Off-route detection with tolerance for GPS noise.
  const tolerance = OFF_ROUTE_M + Math.min(pos.accuracy, 40)
  offRouteCount = progress.offRouteM > tolerance ? offRouteCount + 1 : 0
  if (offRouteCount >= OFF_ROUTE_FIXES && Date.now() - lastRerouteAt > REROUTE_COOLDOWN_MS) {
    s.set({ nav: { ...nav, progress } })
    reroute(pos)
    return
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

let watchId: number | null = null
let fallbackTimer: number | undefined

export function startLocation() {
  if (watchId != null) return
  const useFallback = () => {
    if (get().positionSource !== 'pending') return
    onPosition({ ...FALLBACK_CENTER, heading: null, speed: 0, accuracy: 9999, ts: Date.now() }, 'fallback')
    get().showToast('Location unavailable. Showing Yerevan')
  }
  if (!('geolocation' in navigator)) return useFallback()
  fallbackTimer = window.setTimeout(useFallback, 8000)
  watchId = navigator.geolocation.watchPosition(
    (p) => {
      window.clearTimeout(fallbackTimer)
      if (sim.running) return
      const h = p.coords.heading
      onPosition(
        {
          lon: p.coords.longitude,
          lat: p.coords.latitude,
          heading: h != null && !Number.isNaN(h) && (p.coords.speed ?? 0) > 0.8 ? h : null,
          speed: p.coords.speed ?? 0,
          accuracy: p.coords.accuracy,
          ts: p.timestamp,
        },
        'gps',
      )
    },
    () => {
      window.clearTimeout(fallbackTimer)
      useFallback()
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
  )
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
