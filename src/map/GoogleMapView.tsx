/**
 * The map on Google Maps (test). Does what the standard map does for driving: the car
 * and the follow camera with turn zoom, route choices, the route in traffic colours,
 * the trip's stops, a dropped pin, charger pins, and Google's traffic on other roads.
 * 3D off and the lite map give a flat view; the places toggle switches Map ID (see
 * googleMapId) and lets Google's place icons be tapped.
 */
import { useEffect, useRef } from 'react'
import { chargerToPlace, filterChargers, isFast } from '../lib/chargers'
import { lerp, lerpAngle, lerpLngLat, type LngLat } from '../lib/geo'
import { angleDiff } from '../nav/heading'
import { FALLBACK_CENTER, selectRoute } from '../nav/controller'
import { stopLetter, stopsOf } from '../nav/stops'
import { shownRoute } from '../nav/trafficSync'
import { googleMapId, loadGoogleMaps } from '../services/googleMaps'
import { reverseGeocode } from '../services/search'
import { isLite, useStore } from '../state/store'
import type { Place, Position } from '../types'
import { createNavZoom, followZoom } from './camera'
import { loadArmenianLabels } from './armenianLabels'
import { createLaneCallout, guiding } from './laneCallout'
import { gpuName, isSlowGpu, watchFrameRate } from './performance'
import { needsRedraw, syncPool, trafficAhead, type AheadState } from './routeAhead'
import { ROUTE, TRAFFIC } from './style'

const CAR_SVG = `<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
  <path d="M20 4 L32 34 L20 27.5 L8 34 Z" fill="#e5262f" stroke="#ffffff" stroke-opacity=".9" stroke-width="1.6" stroke-linejoin="round"/>
</svg>`
const pinSvg = (fill: string, letter?: string) => `<svg viewBox="0 0 32 42" width="32" height="42" aria-hidden="true">
  <path d="M16 1C8 1 2 7 2 15c0 10.5 14 25.5 14 25.5S30 25.5 30 15C30 7 24 1 16 1z" fill="${fill}" stroke="#fff" stroke-width="2"/>
  ${letter ? `<text x="16" y="20.5" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">${letter}</text>` : '<circle cx="16" cy="15" r="5" fill="#fff"/>'}
</svg>`
/** Charger pin: a map pin with a lightning bolt (red = fast, white = standard), as on the standard map. */
const chargerPinSvg = (fast: boolean) => {
  const [fill, line] = fast ? ['#e5262f', '#ffffff'] : ['#f4f4f4', '#26272b']
  return `<svg viewBox="0 0 32 42" width="32" height="42" aria-hidden="true">
  <path d="M16 1.5C8.5 1.5 2.5 7.3 2.5 15c0 10.2 13.5 25 13.5 25S29.5 25.2 29.5 15C29.5 7.3 23.5 1.5 16 1.5z" fill="${fill}" stroke="${line}" stroke-width="2"/>
  <path transform="translate(7 6) scale(.75)" d="M13 2 4 14h7l-1 8 9-12h-7z" fill="${line}"/>
</svg>`
}
const LEVEL_COLOUR ={ low: TRAFFIC.free, moderate: TRAFFIC.moderate, heavy: TRAFFIC.heavy, severe: TRAFFIC.severe }

function el(html: string, className: string) {
  const d = document.createElement('div')
  d.className = className
  d.innerHTML = html
  return d
}

const toLatLng = ([lon, lat]: LngLat) => ({ lat, lng: lon })
const path = (coords: LngLat[]) => coords.map(toLatLng)

/** The point `m` metres from `at` towards `bearing`. */
function ahead(at: LngLat, bearing: number, m: number): LngLat {
  const r = (bearing * Math.PI) / 180
  return [at[0] + (m * Math.sin(r)) / (111_320 * Math.cos((at[1] * Math.PI) / 180)), at[1] + (m * Math.cos(r)) / 111_320]
}

export function GoogleMapView() {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let stop = () => {}
    let disposed = false
    loadGoogleMaps(useStore.getState().lang.slice(0, 2))
      .then(async () => {
        if (disposed || !container.current) return
        stop = await start(container.current)
        if (disposed) stop()
      })
      .catch((err) => {
        console.warn('[google map]', err)
        if (disposed || useStore.getState().mapProvider !== 'google') return
        useStore.getState().set({ mapProvider: 'standard' })
        useStore.getState().showToast('The Google map couldn’t load. Back on the standard map.')
      })
    return () => {
      disposed = true
      stop()
    }
  }, [])

  return <div ref={container} className="map" aria-label="Map" role="application" />
}

async function start(container: HTMLDivElement): Promise<() => void> {
  // Armenian letters for the labels, fetched while Google's libraries load (see armenianLabels.ts).
  const letters = loadArmenianLabels()
  const { Map, Polyline, TrafficLayer, RenderingType } = (await google.maps.importLibrary('maps')) as google.maps.MapsLibrary
  const { ColorScheme } = (await google.maps.importLibrary('core')) as google.maps.CoreLibrary
  const { AdvancedMarkerElement } = (await google.maps.importLibrary('marker')) as google.maps.MarkerLibrary
  // Older car computers: start on the lite map straight away when the GPU is a known slow one.
  if (useStore.getState().mapDetail === 'auto' && !useStore.getState().autoLite && isSlowGpu(gpuName())) {
    useStore.getState().set({ autoLite: true })
  }
  const s0 = useStore.getState()
  /**
   * Google draws its buildings in 3D only when the map is tilted, and has no switch for
   * them, so "3D" off (or the lite map) is a flat, straight-down view.
   */
  const tiltFor = (s: Parameters<typeof isLite>[0] & { northUp: boolean; threeD: boolean }) =>
    s.northUp || !s.threeD || isLite(s) ? 0 : 55

  await letters
  const map = new Map(container, {
    center: toLatLng([s0.position?.lon ?? FALLBACK_CENTER.lon, s0.position?.lat ?? FALLBACK_CENTER.lat]),
    zoom: 16.4,
    tilt: tiltFor(s0),
    heading: 0,
    mapId: googleMapId(s0.showPois),
    renderingType: RenderingType.VECTOR,
    colorScheme: s0.theme === 'dark' ? ColorScheme.DARK : ColorScheme.LIGHT,
    mapTypeId: s0.satellite ? 'hybrid' : 'roadmap',
    disableDefaultUI: true,
    keyboardShortcuts: false,
    // Google's place icons can be tapped only while places are switched on.
    clickableIcons: s0.showPois,
    gestureHandling: 'greedy',
    isFractionalZoomEnabled: true,
  })
  // For checking the camera from the browser console while developing.
  if (import.meta.env.DEV) (window as unknown as { __gmap?: google.maps.Map }).__gmap = map
  const listeners: google.maps.MapsEventListener[] = []
  const on = (name: string, fn: (e: google.maps.MapMouseEvent) => void) => listeners.push(map.addListener(name, fn))

  /* ------------------------------------------------------ markers */
  const carEl = el(CAR_SVG, 'car-marker')
  const car = new AdvancedMarkerElement({ content: carEl, zIndex: 1000 })
  let stopMarkers: google.maps.marker.AdvancedMarkerElement[] = []
  let pinMarker: google.maps.marker.AdvancedMarkerElement | null = null
  // Lane bubble at the next junction (see laneCallout.ts). Google sets a marker's bottom
  // centre on its point; the bubble is moved left and down so its pointer touches it.
  let laneMarker: google.maps.marker.AdvancedMarkerElement | null = null
  const updateLanes = createLaneCallout({
    show: (el, at) => {
      if (laneMarker) laneMarker.map = null
      el.classList.add('lanes-anchor--google')
      laneMarker = new AdvancedMarkerElement({ map, position: toLatLng(at), content: el, zIndex: 960 })
    },
    hide: () => {
      if (laneMarker) laneMarker.map = null
      laneMarker = null
    },
  })

  /* ------------------------------------------------------ charging stations */
  let chargerMarkers: google.maps.marker.AdvancedMarkerElement[] = []
  function drawChargers() {
    for (const m of chargerMarkers) m.map = null
    chargerMarkers = []
    const s = useStore.getState()
    if (!s.showChargers) return
    chargerMarkers = filterChargers(s.chargers, s.chargerFilter).map((c) => {
      const fast = isFast(c)
      const content = el(chargerPinSvg(fast), 'gcharger')
      if (c.maxKw != null) {
        const kw = document.createElement('span')
        kw.className = 'gcharger__kw'
        kw.textContent = `${c.maxKw} kW`
        content.appendChild(kw)
      }
      // Fast chargers draw on top where pins overlap.
      const m = new AdvancedMarkerElement({ map, position: toLatLng([c.lon, c.lat]), content, title: c.name, zIndex: fast ? 2 : 1, gmpClickable: true })
      m.addEventListener('gmp-click', () => {
        const st = useStore.getState()
        if (st.panelOpen) st.closePanel()
        st.set({ selectedPlace: chargerToPlace(c) })
      })
      return m
    })
  }
  /** Pins are smaller when zoomed far out, and show their power from street level, as on the standard map. */
  const applyChargerZoom = () => {
    const z = map.getZoom() ?? 16
    container.dataset.chargerLabels = String(z >= 13)
    container.dataset.chargerSmall = String(z < 11)
  }

  /* ------------------------------------------------------ traffic on other roads */
  const traffic = new TrafficLayer()
  const applyTraffic = () => {
    const s = useStore.getState()
    traffic.setMap(s.showTraffic && (!s.nav || s.trafficAllRoads) ? map : null)
  }

  /* ------------------------------------------------------ camera and car */
  let lastHeading = 0
  const navZoom = createNavZoom()
  function guidanceZoom(speed: number): number | null {
    const nav = useStore.getState().nav
    const guiding = nav?.status === 'active' || nav?.status === 'rerouting'
    if (!guiding || !nav.route || !nav.progress) return null
    const pr = nav.progress
    const next = nav.route.maneuvers[pr.nextIndex]
    const prev = nav.route.maneuvers[pr.nextIndex - 1]
    return navZoom({
      route: nav.route,
      speed,
      onRoute: pr.offRouteM < 30,
      next: next ? { index: pr.nextIndex, type: next.type, toM: pr.toNextM } : null,
      prev: prev ? { type: prev.type, pastM: pr.alongM - prev.atM } : null,
    })
  }
  /** Where the camera should be for the car at `at`. While navigating, the car sits low on the screen, like in the car. */
  function cameraFor(at: LngLat, pos: Position) {
    const s = useStore.getState()
    if (pos.heading != null && Math.abs(angleDiff(lastHeading, pos.heading)) >= 3) lastHeading = pos.heading
    const heading = s.northUp ? 0 : lastHeading
    const zoom = guidanceZoom(pos.speed) ?? followZoom({ navigating: !!s.nav?.route, speed: pos.speed, current: map.getZoom() ?? 16 })
    let center = at
    if (s.nav?.route && !s.northUp) {
      const metresPerPx = (156_543 * Math.cos((at[1] * Math.PI) / 180)) / 2 ** zoom
      center = ahead(at, heading, container.clientHeight * 0.16 * metresPerPx * 1.6)
    }
    return { center, heading, tilt: tiltFor(s), zoom }
  }

  let shownCar: { at: LngLat; heading: number } | null = null
  let anim = 0
  /** Called on every frame the camera moves, for measuring how smoothly the map draws. */
  let onFrame: (() => void) | null = null
  const placeCar = () => {
    if (!shownCar) return
    car.position = toLatLng(shownCar.at)
    carEl.style.transform = `translateY(50%) rotate(${shownCar.heading - (map.getHeading() ?? 0)}deg)`
  }
  /** Moves the car (and the camera, when following) smoothly to the new fix. */
  function moveTo(pos: Position, at: LngLat, duration: number) {
    cancelAnimationFrame(anim)
    const heading = pos.heading ?? shownCar?.heading ?? 0
    if (!shownCar || duration === 0) {
      shownCar = { at, heading }
      car.map = map
      placeCar()
      if (useStore.getState().follow) {
        const c = cameraFor(at, pos)
        map.moveCamera({ center: toLatLng(c.center), heading: c.heading, tilt: c.tilt, zoom: c.zoom })
      }
      return
    }
    const fromCar = { ...shownCar }
    const follow = useStore.getState().follow
    const target = cameraFor(at, pos)
    const c0 = map.getCenter()
    const fromCam = { center: [c0?.lng() ?? at[0], c0?.lat() ?? at[1]] as LngLat, heading: map.getHeading() ?? 0, tilt: map.getTilt() ?? 0, zoom: map.getZoom() ?? 16 }
    const t0 = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration)
      shownCar = { at: lerpLngLat(fromCar.at, at, t), heading: lerpAngle(fromCar.heading, heading, t) }
      if (follow && useStore.getState().follow) {
        map.moveCamera({
          center: toLatLng(lerpLngLat(fromCam.center, target.center, t)),
          heading: lerpAngle(fromCam.heading, target.heading, t),
          tilt: lerp(fromCam.tilt, target.tilt, t),
          zoom: lerp(fromCam.zoom, target.zoom, t),
        })
      }
      placeCar()
      onFrame?.()
      if (t < 1) anim = requestAnimationFrame(step)
    }
    anim = requestAnimationFrame(step)
  }
  const carAt = (s: ReturnType<typeof useStore.getState>): LngLat | null => {
    const p = s.position
    if (!p) return null
    return s.nav?.progress && s.nav.progress.offRouteM < 30 ? s.nav.progress.snapped : [p.lon, p.lat]
  }
  const recenter = () => {
    const s = useStore.getState()
    const at = carAt(s)
    if (at && s.position) moveTo(s.position, at, 600)
  }

  /* ------------------------------------------------------ routes */
  let optionLines: google.maps.Polyline[] = []
  const casing = new Polyline({ strokeColor: ROUTE.casing, strokeWeight: 12, zIndex: 10, clickable: false })
  const line = new Polyline({ strokeColor: ROUTE.line, strokeWeight: 8, zIndex: 11, clickable: false })
  let trafficLines: google.maps.Polyline[] = []

  function drawOptions(fit: boolean) {
    for (const l of optionLines) l.setMap(null)
    optionLines = []
    const nav = useStore.getState().nav
    const options = nav?.status === 'choosing' ? nav.options ?? [] : []
    options.forEach((o, i) => {
      const selected = i === nav?.selected
      const l = new Polyline({
        map,
        path: path(o.route.coords),
        strokeColor: selected ? ROUTE.line : '#b9bcc2',
        strokeWeight: selected ? 9 : 8,
        strokeOpacity: 1,
        zIndex: selected ? 6 : 5,
        clickable: !selected,
      })
      if (!selected) l.addListener('click', () => selectRoute(i))
      optionLines.push(l)
    })
    if (fit && options.length) {
      const bounds = new google.maps.LatLngBounds()
      for (const o of options) for (const c of o.route.coords) bounds.extend(toLatLng(c))
      const card = document.querySelector('.left-column')?.getBoundingClientRect()
      cancelAnimationFrame(anim)
      map.moveCamera({ tilt: 0, heading: 0 })
      map.fitBounds(bounds, { top: 90, bottom: 60, right: 110, left: (card?.right ?? 0) + 40 })
    }
  }

  // The route and its traffic are trimmed behind the car only every few metres, and the
  // same lines are reused, instead of a new set of lines on every GPS fix (see routeAhead.ts).
  let routeDrawn: AheadState | null = null
  function drawRoute() {
    const nav = useStore.getState().nav
    const route = nav?.status === 'choosing' ? null : nav?.route
    if (!route) {
      routeDrawn = null
      casing.setMap(null)
      line.setMap(null)
      return
    }
    const p = nav!.progress
    const next: AheadState = { route, traffic: null, fromM: p?.alongM ?? 0 }
    if (!needsRedraw(routeDrawn, next)) return
    routeDrawn = next
    const coords = p ? [p.snapped, ...route.coords.slice(p.segIndex + 1)] : route.coords
    casing.setPath(path(coords))
    line.setPath(path(coords))
    if (casing.getMap() !== map) casing.setMap(map)
    if (line.getMap() !== map) line.setMap(map)
  }

  let trafficDrawn: AheadState | null = null
  function drawRouteTraffic() {
    const s = useStore.getState()
    const route = shownRoute(s.nav)
    const t = s.routeTraffic
    const fromM = s.nav?.status === 'choosing' ? 0 : (s.nav?.progress?.alongM ?? 0)
    const showing = route && t && t.route === route
    const next: AheadState = { route: showing ? route : null, traffic: showing ? t : null, fromM: showing ? fromM : 0 }
    if (!needsRedraw(trafficDrawn, next)) return
    trafficDrawn = next
    const pieces = showing ? trafficAhead(route, t.spans, fromM) : []
    trafficLines = syncPool(
      trafficLines,
      pieces,
      (p) => new Polyline({ map, path: path(p.coords), strokeColor: LEVEL_COLOUR[p.level], strokeWeight: 8, zIndex: 12, clickable: false }),
      (l, p) => l.setOptions({ path: path(p.coords), strokeColor: LEVEL_COLOUR[p.level] }),
      (l) => l.setMap(null),
    )
  }

  function drawStops() {
    for (const m of stopMarkers) m.map = null
    const stops = stopsOf(useStore.getState().nav)
    stopMarkers = stops.map((p, i) => {
      const last = i === stops.length - 1
      const html = stops.length > 1 ? pinSvg(last ? '#e5262f' : '#2f2e30', stopLetter(i)) : pinSvg('#e5262f')
      return new AdvancedMarkerElement({ map, position: toLatLng([p.lon, p.lat]), content: el(html, 'dest-marker'), zIndex: 900 })
    })
  }

  /* ------------------------------------------------------ taps, long press, gestures */
  let pressTimer: number | undefined
  let longPressed = false
  async function dropPin(lon: number, lat: number) {
    longPressed = true
    const placeholder: Place = { id: `pin-${lon.toFixed(5)},${lat.toFixed(5)}`, name: 'Dropped pin', address: 'Finding address…', lon, lat, category: 'pin' }
    useStore.getState().set({ selectedPlace: placeholder, panelOpen: false })
    try {
      const r = await reverseGeocode(lon, lat)
      if (useStore.getState().selectedPlace?.id !== placeholder.id) return
      useStore.getState().set({ selectedPlace: { ...placeholder, name: r?.place.name ?? 'Dropped pin', address: r?.place.address || r?.area || '' } })
    } catch {
      /* keep the placeholder */
    }
  }
  /**
   * Opens one of Google's place icons in Mapic. Its name and address come from Google's
   * Places API (billed per lookup); when that isn't enabled for the key, the place opens
   * unnamed with the address Mapic finds itself.
   */
  async function openGooglePlace(placeId: string, lon: number, lat: number) {
    const placeholder: Place = { id: `poi-${placeId}`, name: 'Place', address: 'Finding address…', lon, lat, category: 'poi' }
    const stillOpen = () => useStore.getState().selectedPlace?.id === placeholder.id
    useStore.getState().set({ selectedPlace: placeholder, panelOpen: false })
    try {
      const { Place: GooglePlace } = (await google.maps.importLibrary('places')) as google.maps.PlacesLibrary
      const p = new GooglePlace({ id: placeId, requestedLanguage: useStore.getState().lang.slice(0, 2) })
      await p.fetchFields({ fields: ['displayName', 'formattedAddress'] })
      if (stillOpen()) useStore.getState().set({ selectedPlace: { ...placeholder, name: p.displayName || 'Place', address: p.formattedAddress ?? '' } })
    } catch (err) {
      console.warn('[google place]', err)
      const r = await reverseGeocode(lon, lat).catch(() => null)
      if (stillOpen()) useStore.getState().set({ selectedPlace: { ...placeholder, address: r?.place.address || r?.area || '' } })
    }
  }
  on('mousedown', (e) => {
    longPressed = false
    window.clearTimeout(pressTimer)
    const ll = e.latLng
    if (ll) pressTimer = window.setTimeout(() => dropPin(ll.lng(), ll.lat()), 550)
  })
  on('mouseup', () => window.clearTimeout(pressTimer))
  on('contextmenu', (e) => {
    window.clearTimeout(pressTimer)
    if (e.latLng && !longPressed) dropPin(e.latLng.lng(), e.latLng.lat())
  })
  on('dragstart', () => {
    window.clearTimeout(pressTimer)
    if (useStore.getState().follow) useStore.getState().set({ follow: false })
  })
  on('click', (e) => {
    if (longPressed) {
      longPressed = false
      return
    }
    const s = useStore.getState()
    // One of Google's place icons: keep Google's own info window closed, and open the place in Mapic.
    const placeId = (e as google.maps.IconMouseEvent).placeId
    if (placeId) e.stop()
    if (s.panelOpen) return s.closePanel()
    if (placeId && e.latLng && s.showPois) return void openGooglePlace(placeId, e.latLng.lng(), e.latLng.lat())
    if (s.selectedPlace) return s.set({ selectedPlace: null })
    s.set({ toolsVisible: !s.toolsVisible })
  })
  on('zoom_changed', applyChargerZoom)

  // Measured fallback: switch to lite if the map keeps drawing slowly while it follows the car.
  let stopFpsWatch: (() => void) | null = null
  if (s0.mapDetail === 'auto' && !s0.autoLite) {
    stopFpsWatch = watchFrameRate({ on: (_e, cb) => (onFrame = cb), off: () => (onFrame = null) }, (fps) => {
      const st = useStore.getState()
      if (st.mapDetail !== 'auto' || st.autoLite) return
      st.set({ autoLite: true })
      st.showToast(`Switched to the lite map for smoother driving (${fps} fps)`)
    })
  }
  let headingFrame = 0
  on('heading_changed', () => {
    placeCar()
    cancelAnimationFrame(headingFrame)
    headingFrame = requestAnimationFrame(() => useStore.getState().set({ mapBearing: map.getHeading() ?? 0 }))
  })

  /* ------------------------------------------------------ react to app state */
  const unsub = useStore.subscribe((s, prev) => {
    if (s.position && s.position !== prev.position) {
      const at = carAt(s)!
      moveTo(s.position, at, prev.position ? 950 : 0)
    }
    if ((s.follow && !prev.follow) || s.northUp !== prev.northUp || (s.nav?.route !== prev.nav?.route && s.nav?.status !== 'choosing')) recenter()
    if (tiltFor(s) !== tiltFor(prev) && s.nav?.status !== 'choosing') {
      if (s.follow && s.position) recenter()
      else map.moveCamera({ tilt: tiltFor(s) })
    }
    if (s.showTraffic !== prev.showTraffic || s.trafficAllRoads !== prev.trafficAllRoads || !s.nav !== !prev.nav) applyTraffic()
    if (s.satellite !== prev.satellite) map.setMapTypeId(s.satellite ? 'hybrid' : 'roadmap')
    if (s.showPois !== prev.showPois) map.setOptions({ clickableIcons: s.showPois })
    if (s.showChargers !== prev.showChargers || s.chargers !== prev.chargers || s.chargerFilter !== prev.chargerFilter) drawChargers()
    if (s.nav?.options !== prev.nav?.options || s.nav?.selected !== prev.nav?.selected || s.nav?.status !== prev.nav?.status) drawOptions(s.nav?.options !== prev.nav?.options)
    if (s.nav?.route !== prev.nav?.route || s.nav?.progress !== prev.nav?.progress || s.nav?.status !== prev.nav?.status) drawRoute()
    if (s.nav !== prev.nav) updateLanes(guiding(s.nav) ? s.nav!.route : null, s.nav?.progress)
    if (s.routeTraffic !== prev.routeTraffic || s.nav !== prev.nav) drawRouteTraffic()
    if (s.nav?.destination !== prev.nav?.destination || s.nav?.via !== prev.nav?.via) drawStops()
    if (s.selectedPlace !== prev.selectedPlace) {
      if (pinMarker) pinMarker.map = null
      pinMarker = null
      const sp = s.selectedPlace
      if (sp && !s.nav) {
        // A charger already has its own pin on the map.
        if (!(sp.charger && s.showChargers)) pinMarker = new AdvancedMarkerElement({ map, position: toLatLng([sp.lon, sp.lat]), content: el(pinSvg('#e5262f'), 'dest-marker'), zIndex: 950 })
        if (sp.id !== prev.selectedPlace?.id) {
          if (s.follow) s.set({ follow: false })
          cancelAnimationFrame(anim)
          map.moveCamera({ center: toLatLng([sp.lon, sp.lat]), zoom: Math.max(map.getZoom() ?? 16, 16) })
        }
      }
    }
  })

  // What is already on screen when the map opens.
  const s = useStore.getState()
  applyTraffic()
  applyChargerZoom()
  drawChargers()
  drawOptions(true)
  drawRoute()
  drawRouteTraffic()
  drawStops()
  const at = carAt(s)
  if (at && s.position) moveTo(s.position, at, 0)

  return () => {
    unsub()
    cancelAnimationFrame(anim)
    cancelAnimationFrame(headingFrame)
    window.clearTimeout(pressTimer)
    for (const l of listeners) l.remove()
    for (const l of [...optionLines, ...trafficLines, casing, line]) l.setMap(null)
    for (const m of [...stopMarkers, ...chargerMarkers]) m.map = null
    if (pinMarker) pinMarker.map = null
    stopFpsWatch?.()
    if (laneMarker) laneMarker.map = null
    car.map = null
    traffic.setMap(null)
  }
}
