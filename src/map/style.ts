import type { ExpressionSpecification, Map as MLMap, SkySpecification, StyleSpecification } from 'maplibre-gl'
import type { Theme } from '../state/store'

/**
 * Graphite night map and soft-grey day map, in the spirit of the in-car map:
 * near-white roads, extruded buildings, minimal labels.
 * Vector data: OpenFreeMap (OpenMapTiles schema, © OpenStreetMap).
 */
export interface Palette {
  ground: string
  park: string
  water: string
  building: string
  buildingTop: string
  roadMajor: string
  roadMid: string
  roadMinor: string
  roadService: string
  casing: string
  path: string
  rail: string
  label: string
  labelMuted: string
  halo: string
  sky: string
  horizon: string
}

export const PALETTES: Record<Theme, Palette> = {
  dark: {
    ground: '#4a4749',
    park: '#474b46',
    water: '#383f48',
    building: '#5f5c5e',
    buildingTop: '#6a6769',
    roadMajor: '#ece8ea',
    roadMid: '#dcd8da',
    roadMinor: '#b9b5b7',
    roadService: '#8f8b8d',
    casing: '#353334',
    path: '#6f6b6d',
    rail: '#5d5a5c',
    label: '#e4e0e2',
    labelMuted: '#b3afb1',
    halo: '#3a3839',
    sky: '#2b292a',
    horizon: '#3b393a',
  },
  light: {
    ground: '#e6e5e3',
    park: '#d9e3d3',
    water: '#b3cbe0',
    building: '#d3d1cf',
    buildingTop: '#dedcda',
    roadMajor: '#ffffff',
    roadMid: '#ffffff',
    roadMinor: '#fbfbfb',
    roadService: '#f3f3f3',
    casing: '#bdbbb9',
    path: '#c4c2c0',
    rail: '#c9c7c5',
    label: '#3c3e42',
    labelMuted: '#5c5e62',
    halo: '#f7f7f6',
    sky: '#dfe6ee',
    horizon: '#eceef0',
  },
}

/** Charging station pins, on both maps: solid Tesla red (no outline) with a white bolt, fast or not (the Fast filter and the kW label tell them apart). */
export const CHARGER_PIN = { fill: '#e82127', mark: '#ffffff' }

export const ROUTE = { line: '#3e6ae1', casing: '#1d3a8f' }
export const TRAFFIC = { free: '#2fb36d', moderate: '#f39c12', heavy: '#e5262f', severe: '#9b111e' }

/** Road classes (Mapbox Traffic v1) where free-flowing traffic is drawn in green. */
export const FREE_FLOW_CLASSES = ['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'tertiary']
export const TRAFFIC_LAYERS = ['traffic-free', 'traffic'] as const

/** Layers that draw the vector "drawing" of the map; hidden under satellite imagery. */
const DRAWN_LAYERS = ['park', 'landcover', 'water', 'waterway', 'rail', 'path', 'road-casing', 'road-service', 'road-minor', 'road-mid', 'road-major', 'buildings']

const NAME: ExpressionSpecification = ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']]
const width = (stops: [number, number][]): ExpressionSpecification =>
  ['interpolate', ['exponential', 1.6], ['zoom'], ...stops.flat()] as ExpressionSpecification
const classIs = (...classes: string[]): ExpressionSpecification => ['match', ['get', 'class'], classes, true, false]

/** Every theme-dependent paint value, by layer. Used to build the style and to switch themes live. */
function themedPaint(p: Palette, satellite: boolean): Record<string, Record<string, unknown>> {
  const label = satellite ? '#ffffff' : p.label
  const labelMuted = satellite ? '#f2f2f2' : p.labelMuted
  const halo = satellite ? 'rgba(0,0,0,0.75)' : p.halo
  return {
    bg: { 'background-color': p.ground },
    park: { 'fill-color': p.park },
    landcover: { 'fill-color': p.park },
    water: { 'fill-color': p.water },
    waterway: { 'line-color': p.water },
    rail: { 'line-color': p.rail },
    path: { 'line-color': p.path },
    'road-casing': { 'line-color': p.casing },
    'road-service': { 'line-color': p.roadService },
    'road-minor': { 'line-color': p.roadMinor },
    'road-mid': { 'line-color': p.roadMid },
    'road-major': { 'line-color': p.roadMajor },
    buildings: {
      'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, p.building, 40, p.buildingTop],
    },
    'road-label': { 'text-color': labelMuted, 'text-halo-color': halo },
    'poi-label': { 'text-color': labelMuted, 'text-halo-color': halo },
    'place-label': { 'text-color': label, 'text-halo-color': halo },
  }
}

function sky(p: Palette): SkySpecification {
  return {
    'sky-color': p.sky,
    'horizon-color': p.horizon,
    'fog-color': p.ground,
    'sky-horizon-blend': 0.6,
    'horizon-fog-blend': 0.8,
    'fog-ground-blend': 0.7,
  }
}

export interface StyleOptions {
  theme: Theme
  satellite: boolean
  trafficTiles: string | null
}

export function buildStyle({ theme, satellite, trafficTiles }: StyleOptions): StyleSpecification {
  const p = PALETTES[theme]
  const paint = themedPaint(p, satellite)
  const vis = (on: boolean) => ({ visibility: on ? ('visible' as const) : ('none' as const) })
  const drawn = vis(!satellite)

  const style: StyleSpecification = {
    version: 8,
    name: 'car-nav',
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '© OpenStreetMap contributors · OpenFreeMap' },
      // Prototype imagery. Esri's terms require an ArcGIS account for production use.
      satellite: {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
      },
    },
    sky: sky(p),
    light: { anchor: 'viewport', color: '#ffffff', intensity: theme === 'dark' ? 0.35 : 0.25, position: [1.2, 210, 35] },
    layers: [
      { id: 'bg', type: 'background', paint: paint.bg },
      { id: 'satellite', type: 'raster', source: 'satellite', layout: vis(satellite), paint: { 'raster-fade-duration': 150 } },
      { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', layout: drawn, paint: paint.park },
      { id: 'landcover', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: classIs('wood', 'grass', 'farmland'), layout: drawn, paint: { ...paint.landcover, 'fill-opacity': 0.6 } },
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', layout: drawn, paint: paint.water },
      { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', layout: drawn, paint: { ...paint.waterway, 'line-width': width([[10, 0.6], [18, 6]]) } },
      { id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: classIs('rail', 'transit'), layout: drawn, paint: { ...paint.rail, 'line-width': width([[12, 0.6], [18, 2]]) } },
      {
        id: 'path', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 15, filter: classIs('path', 'track'), layout: drawn,
        paint: { ...paint.path, 'line-width': width([[15, 0.6], [19, 2.5]]), 'line-dasharray': [2, 1.5] },
      },
      {
        id: 'road-casing', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: classIs('motorway', 'trunk', 'primary', 'secondary', 'tertiary'),
        layout: { ...drawn, 'line-cap': 'round', 'line-join': 'round' },
        paint: { ...paint['road-casing'], 'line-width': width([[10, 1.5], [14, 5], [18, 30], [20, 70]]) },
      },
      {
        id: 'road-service', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 14, filter: classIs('service'),
        layout: { ...drawn, 'line-cap': 'round', 'line-join': 'round' },
        paint: { ...paint['road-service'], 'line-width': width([[14, 0.5], [18, 5], [20, 12]]) },
      },
      {
        id: 'road-minor', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12, filter: classIs('minor'),
        layout: { ...drawn, 'line-cap': 'round', 'line-join': 'round' },
        paint: { ...paint['road-minor'], 'line-width': width([[12, 0.5], [15, 2], [18, 10], [20, 26]]) },
      },
      {
        id: 'road-mid', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: classIs('secondary', 'tertiary'),
        layout: { ...drawn, 'line-cap': 'round', 'line-join': 'round' },
        paint: { ...paint['road-mid'], 'line-width': width([[10, 0.8], [14, 3], [18, 22], [20, 56]]) },
      },
      {
        id: 'road-major', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: classIs('motorway', 'trunk', 'primary'),
        layout: { ...drawn, 'line-cap': 'round', 'line-join': 'round' },
        paint: { ...paint['road-major'], 'line-width': width([[8, 0.8], [14, 3.5], [18, 26], [20, 64]]) },
      },
      {
        id: 'buildings', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 13,
        filter: ['!=', ['get', 'hide_3d'], true],
        layout: drawn,
        paint: {
          ...paint.buildings,
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13, 0, 14.5, ['coalesce', ['get', 'render_height'], 6]],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 1,
          'fill-extrusion-vertical-gradient': true,
        },
      },
      {
        id: 'road-label', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 14,
        filter: classIs('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'),
        layout: {
          'symbol-placement': 'line',
          'text-field': NAME,
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 14, 11, 18, 15],
          'text-pitch-alignment': 'viewport',
          'text-rotation-alignment': 'map',
          'symbol-spacing': 320,
        },
        paint: { ...paint['road-label'], 'text-halo-width': 1.4 },
      },
      {
        id: 'poi-label', type: 'symbol', source: 'omt', 'source-layer': 'poi', minzoom: 16, filter: ['<=', ['get', 'rank'], 8],
        layout: { 'text-field': NAME, 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-max-width': 8, 'text-anchor': 'top', 'text-offset': [0, 0.5], 'text-optional': true },
        paint: { ...paint['poi-label'], 'text-halo-width': 1.2 },
      },
      {
        id: 'place-label', type: 'symbol', source: 'omt', 'source-layer': 'place',
        // Cities only when zoomed out; districts at mid zoom; nothing at street level (keeps the car clear).
        filter: [
          'any',
          ['all', classIs('city', 'town'), ['<', ['zoom'], 12.5]],
          ['all', classIs('village', 'suburb', 'quarter'), ['>=', ['zoom'], 11], ['<', ['zoom'], 15]],
        ],
        layout: {
          'text-field': NAME,
          'text-font': ['Noto Sans Bold'],
          'text-size': ['match', ['get', 'class'], ['city', 'town'], 16, 13],
          'text-max-width': 8,
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.08,
        },
        paint: { ...paint['place-label'], 'text-halo-width': 1.5 },
      },
    ],
  }

  if (trafficTiles) addTraffic(style, trafficTiles)
  return style
}

/**
 * Live traffic, drawn on each side of the road (features are per direction, so a
 * positive offset puts each one on its own side):
 * - free-flowing main roads as thin green lines, so the layer always reads as "on";
 * - slow traffic as thick orange/red lines on every road, drawn on top.
 */
function addTraffic(style: StyleSpecification, tiles: string) {
  style.sources.traffic = { type: 'vector', tiles: [tiles], minzoom: 6, maxzoom: 16, attribution: 'Traffic © Mapbox' }
  const offset = width([[10, 1], [13, 2.5], [15, 5], [17, 10], [19, 22], [20, 34]])
  const at = style.layers.findIndex((l) => l.id === 'buildings')
  style.layers.splice(
    at,
    0,
    {
      id: 'traffic-free',
      type: 'line',
      source: 'traffic',
      'source-layer': 'traffic',
      minzoom: 10,
      filter: ['all', ['==', ['get', 'congestion'], 'low'], ['match', ['get', 'class'], FREE_FLOW_CLASSES, true, false]],
      layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
      paint: {
        'line-color': TRAFFIC.free,
        'line-width': width([[10, 1], [13, 2], [15, 3.5], [17, 6], [19, 12], [20, 18]]),
        'line-offset': offset,
        'line-opacity': 0.85,
      },
    },
    {
      id: 'traffic',
      type: 'line',
      source: 'traffic',
      'source-layer': 'traffic',
      minzoom: 10,
      filter: ['match', ['get', 'congestion'], ['moderate', 'heavy', 'severe'], true, false],
      layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
      paint: {
        'line-color': ['match', ['get', 'congestion'], 'moderate', TRAFFIC.moderate, 'heavy', TRAFFIC.heavy, TRAFFIC.severe],
        'line-width': width([[10, 2], [13, 4], [15, 7], [17, 13], [19, 26], [20, 40]]),
        'line-offset': offset,
        'line-opacity': 0.95,
      },
    },
  )
}

/** Switch theme and satellite mode on a live map without reloading the style. */
export function applyLook(map: MLMap, theme: Theme, satellite: boolean, threeD: boolean, showPois: boolean) {
  const p = PALETTES[theme]
  for (const [layer, props] of Object.entries(themedPaint(p, satellite))) {
    if (!map.getLayer(layer)) continue
    for (const [prop, value] of Object.entries(props)) map.setPaintProperty(layer, prop as Parameters<MLMap["setPaintProperty"]>[1], value as Parameters<MLMap["setPaintProperty"]>[2])
  }
  for (const layer of DRAWN_LAYERS) {
    if (!map.getLayer(layer)) continue
    const on = !satellite && (layer !== 'buildings' || threeD)
    map.setLayoutProperty(layer, 'visibility', on ? 'visible' : 'none')
  }
  if (map.getLayer('satellite')) map.setLayoutProperty('satellite', 'visibility', satellite ? 'visible' : 'none')
  if (map.getLayer('poi-label')) map.setLayoutProperty('poi-label', 'visibility', showPois ? 'visible' : 'none')
  map.setSky(sky(p))
  map.setLight({ anchor: 'viewport', color: '#ffffff', intensity: theme === 'dark' ? 0.35 : 0.25, position: [1.2, 210, 35] })
}

export function setTrafficVisible(map: MLMap, on: boolean) {
  for (const id of TRAFFIC_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
}

/** Mapbox Traffic v1 vector tiles, when a token is configured (VITE_MAPBOX_TOKEN). */
export function trafficTileUrl(freshMs = 600_000): string | null {
  const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined
  if (!token) return null
  // Mapbox tells browsers to cache a refused tile (401/403) for 12 hours. A tag that
  // changes every 10 minutes gives each page load fresh tile URLs, so a refusal that's
  // since been fixed (e.g. a domain added to the token) can't stick. Live traffic tiles
  // are only cacheable for 90 s anyway.
  const bucket = Math.floor(Date.now() / freshMs)
  return `https://api.mapbox.com/v4/mapbox.mapbox-traffic-v1/{z}/{x}/{y}.vector.pbf?access_token=${token}&fresh=${bucket}`
}
