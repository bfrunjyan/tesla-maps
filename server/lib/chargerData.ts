/**
 * Charging stations: parsing and merging of the upstream sources.
 * Pure functions (no network), tested in server/test/chargers.test.ts.
 */
export interface Charger {
  id: string
  name: string
  operator: string | null
  lon: number
  lat: number
  /** Highest power of any connector, kW. null = unknown. */
  maxKw: number | null
  /** Has DC (fast) connectors. null = unknown. */
  dc: boolean | null
  connectors: string[]
  /** Number of charging points, when known. */
  points: number | null
  source: 'osm' | 'ocm'
  /** Live availability. null until a network shares it with us. */
  status: { state: 'free' | 'busy' | 'offline'; free?: number; total?: number; at: string } | null
}

/** 50 kW and up counts as fast charging (DC). */
export const FAST_KW = 50

const OPERATOR_ALIASES: [RegExp, string][] = [
  [/թիմ\s*էներջի|team\s*energy/i, 'Team Energy'],
  [/^evan\b/i, 'EVAN'],
  [/ener-?go/i, 'EnerGo'],
  [/electro\s*am/i, 'Electro Am'],
  [/eco\s*cars/i, 'EcoCars'],
  [/tesla/i, 'Tesla'],
]

export function normalizeOperator(raw: string | undefined | null): string | null {
  const v = raw?.trim()
  if (!v) return null
  for (const [re, name] of OPERATOR_ALIASES) if (re.test(v)) return name
  return v.slice(0, 60)
}

/* ------------------------------------------------------------ OpenStreetMap */

const OSM_SOCKETS: Record<string, { label: string; dc: boolean }> = {
  type2: { label: 'Type 2', dc: false },
  type2_cable: { label: 'Type 2', dc: false },
  type1: { label: 'Type 1', dc: false },
  gb_ac: { label: 'GB/T AC', dc: false },
  type2_combo: { label: 'CCS2', dc: true },
  type1_combo: { label: 'CCS1', dc: true },
  chademo: { label: 'CHAdeMO', dc: true },
  gb_dc: { label: 'GB/T DC', dc: true },
  tesla_supercharger: { label: 'NACS', dc: true },
  nacs: { label: 'NACS', dc: true },
  tesla_destination: { label: 'Tesla', dc: false },
}

/** "22 kW", "22kW", "22", "150 kW;50 kW", "7.4 kVA" → highest number. */
export function parseKw(value: string | undefined): number | null {
  if (!value) return null
  const nums = [...value.matchAll(/(\d+(?:[.,]\d+)?)\s*(kw|kva|w)?/gi)]
    .map((m) => {
      const n = parseFloat(m[1].replace(',', '.'))
      return /^w$/i.test(m[2] ?? '') ? n / 1000 : n
    })
    .filter((n) => n > 0 && n <= 1000)
  return nums.length ? Math.max(...nums) : null
}

interface OsmElement {
  type: string
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

export function parseOsm(elements: OsmElement[]): Charger[] {
  const out: Charger[] = []
  for (const e of elements) {
    const lat = e.lat ?? e.center?.lat
    const lon = e.lon ?? e.center?.lon
    const t = e.tags ?? {}
    if (lat == null || lon == null) continue
    if (t.access === 'private' || t.access === 'no') continue
    const connectors = new Set<string>()
    let dc: boolean | null = null
    let maxKw = parseKw(t['charging_station:output'])
    for (const [key, value] of Object.entries(t)) {
      const m = /^socket:([a-z0-9_]+)(:output)?$/.exec(key)
      if (!m) continue
      const socket = OSM_SOCKETS[m[1]]
      if (m[2]) {
        const kw = parseKw(value)
        if (kw != null) maxKw = Math.max(maxKw ?? 0, kw)
      } else if (socket && value !== 'no' && value !== '0') {
        connectors.add(socket.label)
        dc = dc || socket.dc
      }
    }
    if (maxKw != null && maxKw >= FAST_KW) dc = true
    const operator = normalizeOperator(t.operator ?? t.brand ?? t.network)
    const points = parseInt(t.capacity ?? '', 10)
    out.push({
      id: `osm-${e.type[0]}${e.id}`,
      name: (t['name:en'] ?? t.name ?? operator ?? 'Charging station').slice(0, 120),
      operator,
      lon,
      lat,
      maxKw,
      dc,
      connectors: [...connectors],
      points: Number.isFinite(points) && points > 0 ? points : null,
      source: 'osm',
      status: null,
    })
  }
  return out
}

/* ---------------------------------------------------------- Open Charge Map */

const OCM_CONNECTORS: Record<number, { label: string; dc: boolean }> = {
  1: { label: 'Type 1', dc: false },
  25: { label: 'Type 2', dc: false },
  1036: { label: 'Type 2', dc: false },
  32: { label: 'CCS1', dc: true },
  33: { label: 'CCS2', dc: true },
  2: { label: 'CHAdeMO', dc: true },
  27: { label: 'NACS', dc: true },
  30: { label: 'Tesla', dc: false },
  1038: { label: 'GB/T AC', dc: false },
  1039: { label: 'GB/T DC', dc: true },
}

interface OcmPoi {
  ID: number
  AddressInfo?: { Title?: string; Latitude?: number; Longitude?: number }
  OperatorInfo?: { Title?: string } | null
  NumberOfPoints?: number | null
  StatusType?: { IsOperational?: boolean | null } | null
  Connections?: {
    PowerKW?: number | null
    Quantity?: number | null
    CurrentTypeID?: number | null
    ConnectionTypeID?: number | null
    ConnectionType?: { Title?: string } | null
  }[]
}

export function parseOcm(pois: OcmPoi[]): Charger[] {
  const out: Charger[] = []
  for (const p of pois) {
    const lat = p.AddressInfo?.Latitude
    const lon = p.AddressInfo?.Longitude
    if (typeof lat !== 'number' || typeof lon !== 'number') continue
    if (p.StatusType?.IsOperational === false) continue // planned, removed or out of service
    const connectors = new Set<string>()
    let dc: boolean | null = null
    let maxKw: number | null = null
    let quantity = 0
    for (const c of p.Connections ?? []) {
      const known = c.ConnectionTypeID != null ? OCM_CONNECTORS[c.ConnectionTypeID] : undefined
      const label = known?.label ?? c.ConnectionType?.Title?.replace(/\s*\(.*\)$/, '').slice(0, 20)
      if (label) connectors.add(label)
      if (known?.dc || c.CurrentTypeID === 30) dc = true
      else if (dc == null && (known || c.CurrentTypeID)) dc = false
      if (typeof c.PowerKW === 'number' && c.PowerKW > 0) maxKw = Math.max(maxKw ?? 0, c.PowerKW)
      quantity += c.Quantity ?? 0
    }
    if (maxKw != null && maxKw >= FAST_KW) dc = true
    const operator = normalizeOperator(p.OperatorInfo?.Title === '(Unknown Operator)' ? null : p.OperatorInfo?.Title)
    out.push({
      id: `ocm-${p.ID}`,
      name: (p.AddressInfo?.Title ?? operator ?? 'Charging station').slice(0, 120),
      operator,
      lon,
      lat,
      maxKw,
      dc,
      connectors: [...connectors],
      points: p.NumberOfPoints ?? (quantity || null),
      source: 'ocm',
      status: null,
    })
  }
  return out
}

/* -------------------------------------------------------------------- merge */

function metres(a: Charger, b: Charger) {
  const k = Math.cos((a.lat * Math.PI) / 180)
  return Math.hypot((a.lon - b.lon) * k, a.lat - b.lat) * 111_320
}

/**
 * Combines sources. Two entries within 60 m are the same station: keep the one that
 * knows its power (Open Charge Map first on ties) and fill gaps from the other.
 */
export function mergeChargers(...lists: Charger[][]): Charger[] {
  const rank = (c: Charger) => (c.maxKw != null ? 2 : 0) + (c.source === 'ocm' ? 1 : 0)
  const all = lists.flat().sort((a, b) => rank(b) - rank(a))
  const kept: Charger[] = []
  for (const c of all) {
    const twin = kept.find((k) => metres(k, c) < 60)
    if (!twin) {
      kept.push({ ...c, connectors: [...c.connectors] })
      continue
    }
    twin.operator ??= c.operator
    twin.points ??= c.points
    twin.dc ??= c.dc
    for (const x of c.connectors) if (!twin.connectors.includes(x)) twin.connectors.push(x)
  }
  return kept
}
