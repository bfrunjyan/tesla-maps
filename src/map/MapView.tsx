import { useEffect, useRef } from 'react'
import type { ExpressionSpecification } from 'maplibre-gl'
import { AttributionControl, Map as MLMap, Marker, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// Bundle MapLibre's worker as its own file so production builds can load it.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { lerpAngle, lerpLngLat, type LngLat } from '../lib/geo'
import { chargerToPlace, filterChargers, isFast } from '../lib/chargers'
import { angleDiff } from '../nav/heading'
import { FALLBACK_CENTER, selectRoute } from '../nav/controller'
import { reverseGeocode } from '../services/search'
import { isLite, useStore } from '../state/store'
import type { Place, Position } from '../types'
import { applyLook, buildStyle, ROUTE, setTrafficVisible, TRAFFIC, trafficTileUrl } from './style'
import { sliceRoute } from '../nav/routeTraffic'
import { stopLetter, stopsOf } from '../nav/stops'
import { shownRoute } from '../nav/trafficSync'
import { createNavZoom, followZoom } from './camera'
import { createLaneCallout, guiding } from './laneCallout'
import { setMap } from './mapApi'
import { gpuName, isSlowGpu, watchFrameRate } from './performance'

const CAR_SVG = `<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
  <path d="M20 4 L32 34 L20 27.5 L8 34 Z" fill="${'#e5262f'}" stroke="#ffffff" stroke-opacity=".9" stroke-width="1.6" stroke-linejoin="round"/>
</svg>`

const PIN_SVG = `<svg viewBox="0 0 32 42" width="32" height="42" aria-hidden="true">
  <path d="M16 1C8 1 2 7 2 15c0 10.5 14 25.5 14 25.5S30 25.5 30 15C30 7 24 1 16 1z" fill="#e5262f" stroke="#fff" stroke-width="2"/>
  <circle cx="16" cy="15" r="5" fill="#fff"/>
</svg>`

/** A stop of a trip with several: its letter on the pin. The destination is red, the stops before it dark. */
const stopPinSvg = (letter: string, last: boolean) => `<svg viewBox="0 0 32 42" width="32" height="42" aria-hidden="true">
  <path d="M16 1C8 1 2 7 2 15c0 10.5 14 25.5 14 25.5S30 25.5 30 15C30 7 24 1 16 1z" fill="${last ? '#e5262f' : '#2f2e30'}" stroke="#fff" stroke-width="2"/>
  <text x="16" y="20.5" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">${letter}</text>
</svg>`

/** Charger pin, drawn once per kind: a map pin with a lightning bolt (red = fast, white = standard; both read on the dark and light map). */
function chargerPin(fill: string, stroke: string, bolt: string) {
  const scale = 2
  const canvas = document.createElement('canvas')
  canvas.width = 32 * scale
  canvas.height = 42 * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  const pin = new Path2D('M16 1.5C8.5 1.5 2.5 7.3 2.5 15c0 10.2 13.5 25 13.5 25S29.5 25.2 29.5 15C29.5 7.3 23.5 1.5 16 1.5z')
  ctx.fillStyle = fill
  ctx.fill(pin)
  ctx.lineWidth = 2
  ctx.strokeStyle = stroke
  ctx.stroke(pin)
  ctx.translate(7, 6)
  ctx.scale(0.75, 0.75)
  ctx.fillStyle = bolt
  ctx.fill(new Path2D('M13 2 4 14h7l-1 8 9-12h-7z'))
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

function el(html: string, className: string) {
  const d = document.createElement('div')
  d.className = className
  d.innerHTML = html
  return d
}

setWorkerUrl(workerUrl)

const EMPTY_LINE: GeoJSON.Feature<GeoJSON.LineString> = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }

export function MapView() {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!container.current) return
    // Older car computers: start in lite mode straight away when the GPU is a known slow one.
    if (useStore.getState().mapDetail === 'auto' && !useStore.getState().autoLite && isSlowGpu(gpuName())) {
      useStore.getState().set({ autoLite: true })
    }
    const s0 = useStore.getState()
    const pixelRatioFor = (lite: boolean) => (lite ? 1 : window.devicePixelRatio || 1)
    const map = new MLMap({
      container: container.current,
      style: buildStyle({ theme: s0.theme, satellite: s0.satellite, trafficTiles: trafficTileUrl() }),
      center: [FALLBACK_CENTER.lon, FALLBACK_CENTER.lat],
      zoom: 16.4,
      pitch: s0.northUp ? 0 : isLite(s0) ? 45 : 55,
      pixelRatio: pixelRatioFor(isLite(s0)),
      maxPitch: 70,
      attributionControl: false,
      fadeDuration: 150,
      dragRotate: true,
      pitchWithRotate: true,
    })
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right')
    // Map credits: shown on load, then collapsed to the (i) button after 5 s or on the
    // first tap/zoom (MapLibre already collapses on drag). This is the pattern the OSM
    // attribution guidelines allow; the (i) button keeps the credits one tap away.
    const collapseCredits = () => {
      map.getContainer().querySelector('.maplibregl-ctrl-attrib.maplibregl-compact')?.classList.remove('maplibregl-compact-show')
    }
    const creditsTimer = window.setTimeout(collapseCredits, 5000)
    map.once('click', collapseCredits)
    map.once('zoomstart', (e) => e.originalEvent && collapseCredits())
    setMap(map)

    /* ------------------------------------------------------ markers */
    const carMarker = new Marker({ element: el(CAR_SVG, 'car-marker'), rotationAlignment: 'map', pitchAlignment: 'map' })
    let stopMarkers: Marker[] = []
    let pinMarker: Marker | null = null
    // Lane bubble at the next junction, its pointer on the junction (see laneCallout.ts).
    let laneMarker: Marker | null = null
    const updateLanes = createLaneCallout({
      show: (el, at) => {
        laneMarker?.remove()
        laneMarker = new Marker({ element: el, anchor: 'right', offset: [-12, 0] }).setLngLat(at).addTo(map)
      },
      hide: () => {
        laneMarker?.remove()
        laneMarker = null
      },
    })

    /* ------------------------------------------ smooth car movement */
    let shown: { at: LngLat; heading: number } | null = null
    let anim = 0
    function moveCar(to: LngLat, heading: number, duration: number) {
      cancelAnimationFrame(anim)
      if (!shown) {
        shown = { at: to, heading }
        carMarker.setLngLat(to).setRotation(heading).addTo(map)
        return
      }
      const from = { ...shown }
      const t0 = performance.now()
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / duration)
        shown = { at: lerpLngLat(from.at, to, t), heading: lerpAngle(from.heading, heading, t) }
        carMarker.setLngLat(shown.at).setRotation(shown.heading)
        if (t < 1) anim = requestAnimationFrame(step)
      }
      anim = requestAnimationFrame(step)
    }

    /* ------------------------------------------------------- camera */
    let lastHeading = 0
    const navZoom = createNavZoom()
    /** During guidance: zoom in for the turn ahead, back out once it's done. Null otherwise. */
    function guidanceZoom(speed: number): number | null {
      const nav = useStore.getState().nav
      const guiding = nav?.status === 'active' || nav?.status === 'rerouting'
      if (!guiding || !nav.route || !nav.progress) return null
      const { maneuvers } = nav.route
      const pr = nav.progress
      const next = maneuvers[pr.nextIndex]
      const prev = maneuvers[pr.nextIndex - 1]
      return navZoom({
        route: nav.route,
        speed,
        onRoute: pr.offRouteM < 30,
        next: next ? { index: pr.nextIndex, type: next.type, toM: pr.toNextM } : null,
        prev: prev ? { type: prev.type, pastM: pr.alongM - prev.atM } : null,
      })
    }
    function cameraFor(pos: Position) {
      const s = useStore.getState()
      // Dead zone: tiny heading changes don't rotate the map (the arrow still turns).
      if (pos.heading != null && Math.abs(angleDiff(lastHeading, pos.heading)) >= 3) lastHeading = pos.heading
      const navigating = !!s.nav?.route
      const h = map.getContainer().clientHeight
      const zoom = guidanceZoom(pos.speed) ?? followZoom({ navigating, speed: pos.speed, current: map.getZoom() })
      return {
        center: [pos.lon, pos.lat] as LngLat,
        bearing: s.northUp ? 0 : lastHeading,
        pitch: s.northUp ? 0 : isLite(s) ? 45 : 55,
        zoom,
        padding: { top: navigating && !s.northUp ? h * 0.32 : 0, bottom: 0, left: 0, right: 0 },
      }
    }

    function follow(pos: Position, duration = 1000) {
      if (!useStore.getState().follow) return
      map.easeTo({ ...cameraFor(pos), duration, easing: (t) => t, essential: true })
    }

    /* -------------------------------------------------- route layers */
    function ensureRouteLayers() {
      if (map.getSource('route')) return
      // Route choices in the preview: others grey (tap to pick), the selected one blue.
      map.addSource('route-options', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      const optionWidth: ExpressionSpecification = ['interpolate', ['exponential', 1.6], ['zoom'], 10, 4, 16, 10, 20, 40]
      map.addLayer({
        id: 'route-opt-alt-casing',
        type: 'line',
        source: 'route-options',
        filter: ['!=', ['get', 'selected'], true],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#1f2023', 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 10, 7, 16, 15, 20, 52] },
      }, 'road-label')
      map.addLayer({
        id: 'route-opt-alt',
        type: 'line',
        source: 'route-options',
        filter: ['!=', ['get', 'selected'], true],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#b9bcc2', 'line-width': optionWidth },
      }, 'road-label')
      map.addLayer({
        id: 'route-opt-sel',
        type: 'line',
        source: 'route-options',
        filter: ['==', ['get', 'selected'], true],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ROUTE.line, 'line-width': optionWidth },
      }, 'road-label')
      map.on('click', 'route-opt-alt-casing', (e) => {
        const i = e.features?.[0]?.properties?.index
        if (typeof i === 'number') selectRoute(i)
      })
      map.addSource('route', { type: 'geojson', data: EMPTY_LINE })
      map.addLayer({
        id: 'route-casing',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ROUTE.casing, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 10, 4, 16, 12, 20, 60] },
      }, 'road-label')
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ROUTE.line, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 10, 2.5, 16, 8.5, 20, 46] },
      }, 'road-label')
      // Traffic along the route, drawn over the route line: green where it flows, up to
      // dark red where it is jammed. Stretches with no traffic data keep the route's blue.
      map.addSource('route-traffic', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'route-traffic',
        type: 'line',
        source: 'route-traffic',
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': ['match', ['get', 'level'], 'low', TRAFFIC.free, 'moderate', TRAFFIC.moderate, 'heavy', TRAFFIC.heavy, TRAFFIC.severe],
          'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 10, 2.5, 16, 8.5, 20, 46],
        },
      }, 'road-label')
    }

    function drawRouteTraffic() {
      const src = map.getSource('route-traffic') as GeoJSONSource | undefined
      if (!src) return
      const s = useStore.getState()
      const route = shownRoute(s.nav)
      const traffic = s.routeTraffic
      if (!route || !traffic || traffic.route !== route) return src.setData({ type: 'FeatureCollection', features: [] })
      // While driving, only what is still ahead of the car.
      const fromM = s.nav?.status === 'choosing' ? 0 : (s.nav?.progress?.alongM ?? 0)
      src.setData({
        type: 'FeatureCollection',
        features: traffic.spans
          .filter((span) => span.toM > fromM)
          .map((span) => ({
            type: 'Feature' as const,
            properties: { level: span.level },
            geometry: { type: 'LineString' as const, coordinates: sliceRoute(route, Math.max(span.fromM, fromM), span.toM) },
          }))
          .filter((f) => f.geometry.coordinates.length > 1),
      })
    }

    function drawRoute() {
      const src = map.getSource('route') as GeoJSONSource | undefined
      if (!src) return
      const nav = useStore.getState().nav
      const route = nav?.route
      if (!route) return src.setData(EMPTY_LINE)
      // Draw only what's still ahead of the car.
      const p = nav.progress
      const coords = p ? [p.snapped, ...route.coords.slice(p.segIndex + 1)] : route.coords
      src.setData({ ...EMPTY_LINE, geometry: { type: 'LineString', coordinates: coords } })
    }

    function ensureChargerLayer() {
      if (map.getSource('chargers')) return
      map.addImage('pin-fast', chargerPin('#e5262f', '#ffffff', '#ffffff'), { pixelRatio: 2 })
      map.addImage('pin-std', chargerPin('#f4f4f4', '#26272b', '#26272b'), { pixelRatio: 2 })
      map.addSource('chargers', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'chargers',
        type: 'symbol',
        source: 'chargers',
        layout: {
          'icon-image': ['case', ['get', 'fast'], 'pin-fast', 'pin-std'],
          'icon-anchor': 'bottom',
          'icon-allow-overlap': true,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 12, 0.9, 16, 1.1],
          // Fast chargers draw on top where pins overlap.
          'symbol-sort-key': ['case', ['get', 'fast'], 1, 0],
          'text-field': ['step', ['zoom'], '', 13, ['get', 'label']],
          'text-font': ['Noto Sans Bold'],
          'text-size': 11,
          'text-anchor': 'top',
          'text-offset': [0, 0.2],
          'text-optional': true,
          visibility: 'none',
        },
        paint: { 'text-color': '#ffffff', 'text-halo-color': '#1c1b1d', 'text-halo-width': 1.4 },
      })
    }

    function drawChargers() {
      const src = map.getSource('chargers') as GeoJSONSource | undefined
      if (!src) return
      const s = useStore.getState()
      map.setLayoutProperty('chargers', 'visibility', s.showChargers ? 'visible' : 'none')
      if (!s.showChargers) return
      src.setData({
        type: 'FeatureCollection',
        features: filterChargers(s.chargers, s.chargerFilter).map((c) => ({
          type: 'Feature' as const,
          properties: { id: c.id, fast: isFast(c), label: c.maxKw != null ? `${c.maxKw} kW` : '' },
          geometry: { type: 'Point' as const, coordinates: [c.lon, c.lat] },
        })),
      })
    }

    function drawOptions(fit: boolean) {
      const src = map.getSource('route-options') as GeoJSONSource | undefined
      const nav = useStore.getState().nav
      const options = nav?.status === 'choosing' ? nav.options ?? [] : []
      // Selected last so it draws on top where routes overlap.
      const features = options
        .map((o, index) => ({
          type: 'Feature' as const,
          properties: { index, selected: index === nav?.selected },
          geometry: { type: 'LineString' as const, coordinates: o.route.coords },
        }))
        .sort((a, b) => Number(a.properties.selected) - Number(b.properties.selected))
      src?.setData({ type: 'FeatureCollection', features })
      if (fit && options.length) {
        const all = options.flatMap((o) => o.route.coords)
        const lons = all.map((c) => c[0])
        const lats = all.map((c) => c[1])
        const card = document.querySelector('.left-column')?.getBoundingClientRect()
        map.fitBounds(
          [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
          { padding: { top: 90, bottom: 60, right: 110, left: (card?.right ?? 0) + 40 }, pitch: 0, bearing: 0, duration: 800, maxZoom: 16 },
        )
      }
    }

    function applyLayerToggles() {
      const s = useStore.getState()
      applyLook(map, s.theme, s.satellite, s.threeD && !isLite(s), s.showPois)
      // With a route on screen, traffic is drawn on the route itself; other roads stay
      // clear unless the driver turns them back on for this trip.
      setTrafficVisible(map, s.showTraffic && (!s.nav || s.trafficAllRoads))
    }

    // Measured fallback: switch to lite if the map keeps drawing slowly while moving.
    let stopFpsWatch: (() => void) | null = null
    if (useStore.getState().mapDetail === 'auto' && !useStore.getState().autoLite) {
      stopFpsWatch = watchFrameRate(map, (fps) => {
        const st = useStore.getState()
        if (st.mapDetail !== 'auto' || st.autoLite) return
        st.set({ autoLite: true })
        st.showToast(`Switched to the lite map for smoother driving (${fps} fps)`)
      })
    }

    // Traffic tiles refused (e.g. the Mapbox token isn't allowed on this site): say so once.
    let trafficErrorShown = false
    map.on('error', (e) => {
      const ev = e as unknown as { sourceId?: string; error?: { status?: number } }
      if (ev.sourceId !== 'traffic' || trafficErrorShown) return
      const status = ev.error?.status
      if (status !== 401 && status !== 403) return
      trafficErrorShown = true
      if (useStore.getState().showTraffic) useStore.getState().showToast('Traffic couldn’t load: the map key isn’t allowed on this site')
      console.warn(`[traffic] tiles refused (${status}). Add this site's URL to the Mapbox token.`)
    })

    map.on('load', () => {
      ensureRouteLayers()
      ensureChargerLayer()
      drawChargers()
      applyLayerToggles()
      drawRoute()
      drawRouteTraffic()
    })

    /* ----------------------------------------------- user gestures */
    const releaseFollow = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent && useStore.getState().follow) useStore.getState().set({ follow: false })
    }
    map.on('dragstart', releaseFollow)
    map.on('rotatestart', releaseFollow)
    map.on('pitchstart', releaseFollow)
    // Zoom gestures keep follow mode: the car stays centred, like in the car.

    let bearingFrame = 0
    map.on('rotate', () => {
      cancelAnimationFrame(bearingFrame)
      bearingFrame = requestAnimationFrame(() => useStore.getState().set({ mapBearing: map.getBearing() }))
    })

    /* ------------------------------------------ tap / long-press */
    let pressTimer: number | undefined
    let pressStart: { x: number; y: number } | null = null
    let longPressed = false
    const cancelPress = () => {
      window.clearTimeout(pressTimer)
      pressStart = null
    }
    const startPress = (x: number, y: number) => {
      longPressed = false
      pressStart = { x, y }
      window.clearTimeout(pressTimer)
      pressTimer = window.setTimeout(() => {
        if (!pressStart) return
        longPressed = true
        const ll = map.unproject([pressStart.x, pressStart.y])
        dropPin(ll.lng, ll.lat)
      }, 550)
    }
    const movePress = (x: number, y: number) => {
      if (pressStart && Math.hypot(x - pressStart.x, y - pressStart.y) > 10) cancelPress()
    }
    map.on('mousedown', (e) => e.originalEvent.button === 0 && startPress(e.point.x, e.point.y))
    map.on('mousemove', (e) => movePress(e.point.x, e.point.y))
    map.on('mouseup', cancelPress)
    map.on('touchstart', (e) => (e.originalEvent.touches.length === 1 ? startPress(e.point.x, e.point.y) : cancelPress()))
    map.on('touchmove', (e) => movePress(e.point.x, e.point.y))
    map.on('touchend', cancelPress)
    map.on('dragstart', cancelPress)

    async function dropPin(lon: number, lat: number) {
      const placeholder: Place = { id: `pin-${lon.toFixed(5)},${lat.toFixed(5)}`, name: 'Dropped pin', address: 'Finding address…', lon, lat, category: 'pin' }
      useStore.getState().set({ selectedPlace: placeholder, panelOpen: false })
      try {
        const r = await reverseGeocode(lon, lat)
        const cur = useStore.getState().selectedPlace
        if (cur?.id !== placeholder.id) return
        useStore.getState().set({
          selectedPlace: { ...placeholder, name: r?.place.name ?? 'Dropped pin', address: r?.place.address || r?.area || '' },
        })
      } catch {
        /* keep placeholder */
      }
    }

    map.on('click', (e) => {
      if (longPressed) {
        longPressed = false
        return
      }
      const s = useStore.getState()
      if (s.panelOpen) return s.closePanel()
      // Charger pins: a generous hit area, since they're tapped from the driver's seat.
      if (s.showChargers && map.getLayer('chargers')) {
        const hit = map.queryRenderedFeatures([[e.point.x - 18, e.point.y - 6], [e.point.x + 18, e.point.y + 44]], { layers: ['chargers'] })[0]
        const charger = hit && s.chargers.find((c) => c.id === hit.properties.id)
        if (charger) return s.set({ selectedPlace: chargerToPlace(charger) })
      }
      const poi = s.showPois && map.getLayer('poi-label') ? map.queryRenderedFeatures(e.point, { layers: ['poi-label'] })[0] : undefined
      if (poi) {
        const [lon, lat] = (poi.geometry as GeoJSON.Point).coordinates
        const props = poi.properties as Record<string, string>
        const name = props['name:en'] || props['name:latin'] || props.name || 'Place'
        const place: Place = { id: `poi-${poi.id ?? name}`, name, address: '', lon, lat, category: 'poi' }
        s.set({ selectedPlace: place })
        reverseGeocode(lon, lat)
          .then((r) => {
            const cur = useStore.getState().selectedPlace
            if (r && cur?.id === place.id) useStore.getState().set({ selectedPlace: { ...cur, address: r.place.address || r.area } })
          })
          .catch(() => {})
        return
      }
      if (s.selectedPlace) return s.set({ selectedPlace: null })
      s.set({ toolsVisible: !s.toolsVisible })
    })

    /* ----------------------------------------- react to app state */
    const unsub = useStore.subscribe((s, prev) => {
      if (s.position && s.position !== prev.position) {
        const p = s.position
        const nav = s.nav
        const at: LngLat = nav?.progress && nav.progress.offRouteM < 30 ? nav.progress.snapped : [p.lon, p.lat]
        const first = !prev.position
        moveCar(at, p.heading ?? lastHeading, first ? 0 : 950)
        follow({ ...p, lon: at[0], lat: at[1] }, first ? 0 : 1000)
      }
      if (s.follow && !prev.follow && s.position) follow(s.position, 600)
      if ((s.northUp !== prev.northUp || s.nav?.route !== prev.nav?.route) && s.position) follow(s.position, 600)
      if (s.northUp !== prev.northUp && !s.follow) map.easeTo({ bearing: s.northUp ? 0 : map.getBearing(), pitch: s.northUp ? 0 : 55, duration: 500 })
      if (
        s.threeD !== prev.threeD ||
        s.showPois !== prev.showPois ||
        s.theme !== prev.theme ||
        s.satellite !== prev.satellite ||
        s.showTraffic !== prev.showTraffic ||
        s.trafficAllRoads !== prev.trafficAllRoads ||
        !s.nav !== !prev.nav ||
        isLite(s) !== isLite(prev)
      ) {
        if (isLite(s) !== isLite(prev)) {
          map.setPixelRatio(pixelRatioFor(isLite(s)))
          if (s.follow && s.position) follow(s.position, 600) // apply the lite camera angle now
          else if (!s.northUp) map.easeTo({ pitch: isLite(s) ? 45 : 55, duration: 600 })
        }
        if (map.isStyleLoaded()) applyLayerToggles()
        else map.once('idle', applyLayerToggles)
      }

      if (s.nav?.options !== prev.nav?.options || s.nav?.selected !== prev.nav?.selected || s.nav?.status !== prev.nav?.status) {
        drawOptions(s.nav?.options !== prev.nav?.options)
      }
      if (s.nav?.route !== prev.nav?.route || s.nav?.progress !== prev.nav?.progress) {
        // Always draw: isStyleLoaded() is false while tiles load (e.g. right after
        // zooming out for the route preview), which used to leave the route undrawn.
        drawRoute()
      }
      if (s.nav !== prev.nav) updateLanes(guiding(s.nav) ? s.nav!.route : null, s.nav?.progress)
      if (s.routeTraffic !== prev.routeTraffic || s.nav !== prev.nav) drawRouteTraffic()
      if (s.nav?.destination !== prev.nav?.destination || s.nav?.via !== prev.nav?.via) {
        for (const m of stopMarkers) m.remove()
        const stops = stopsOf(s.nav)
        // One place: the plain pin. Several: lettered A, B, C in the order they'll be visited.
        stopMarkers = stops.map((p, i) =>
          new Marker({ element: el(stops.length > 1 ? stopPinSvg(stopLetter(i), i === stops.length - 1) : PIN_SVG, 'dest-marker'), anchor: 'bottom' })
            .setLngLat([p.lon, p.lat])
            .addTo(map),
        )
      }
      if (s.selectedPlace !== prev.selectedPlace) {
        pinMarker?.remove()
        pinMarker = null
        const sp = s.selectedPlace
        if (sp && !s.nav) {
          // A charger already has its own pin on the map.
          if (!(sp.charger && s.showChargers)) pinMarker = new Marker({ element: el(PIN_SVG, 'dest-marker'), anchor: 'bottom' }).setLngLat([sp.lon, sp.lat]).addTo(map)
          if (sp.id !== prev.selectedPlace?.id) {
            if (s.follow) s.set({ follow: false })
            map.easeTo({ center: [sp.lon, sp.lat], zoom: Math.max(map.getZoom(), 16), duration: 700, padding: { left: 0, top: 0, bottom: 0, right: 0 } })
          }
        }
      }
      if (s.showChargers !== prev.showChargers || s.chargers !== prev.chargers || s.chargerFilter !== prev.chargerFilter) drawChargers()
    })

    const ro = new ResizeObserver(() => map.resize())
    ro.observe(container.current)

    return () => {
      unsub()
      ro.disconnect()
      cancelAnimationFrame(anim)
      window.clearTimeout(creditsTimer)
      stopFpsWatch?.()
      setMap(null)
      map.remove()
    }
  }, [])

  return <div ref={container} className="map" aria-label="Map" role="application" />
}
