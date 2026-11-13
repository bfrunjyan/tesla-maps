import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from '../db.ts'
import { mergeChargers, normalizeOperator, parseKw, parseOcm, parseOsm } from '../lib/chargerData.ts'
import { resetChargerFeed } from '../lib/chargers.ts'
import { client, resetDatabase } from './helpers.ts'

const osm = (id: number, lat: number, lon: number, tags: Record<string, string>) => ({ type: 'node', id, lat, lon, tags: { amenity: 'charging_station', ...tags } })

describe('parseKw', () => {
  it.each([
    ['22 kW', 22],
    ['22kW', 22],
    ['7.4 kVA', 7.4],
    ['150 kW;50 kW', 150],
    ['11000 W', 11],
    ['', null],
    [undefined, null],
  ])('%s → %s', (input, expected) => expect(parseKw(input)).toBe(expected))
})

describe('normalizeOperator', () => {
  it('maps Armenian and English spellings to one name', () => {
    expect(normalizeOperator('Թիմ էներջի')).toBe('Team Energy')
    expect(normalizeOperator('TEAM ENERGY')).toBe('Team Energy')
    expect(normalizeOperator('  ')).toBeNull()
  })
})

describe('parseOsm', () => {
  it('reads connectors, power and operator', () => {
    const [c] = parseOsm([osm(1, 40.19, 44.54, { operator: 'EnerGo', 'socket:gb_ac': '1', 'socket:gb_ac:output': '22 kW', capacity: '1' })])
    expect(c).toMatchObject({ id: 'osm-n1', name: 'EnerGo', operator: 'EnerGo', maxKw: 22, dc: false, connectors: ['GB/T AC'], points: 1, status: null })
  })

  it('marks DC connectors and 50 kW+ as DC', () => {
    const [ccs] = parseOsm([osm(2, 40.2, 44.5, { 'socket:type2_combo': '2', 'socket:type2_combo:output': '120 kW' })])
    expect(ccs).toMatchObject({ maxKw: 120, dc: true, connectors: ['CCS2'] })
  })

  it('leaves power unknown when it is not tagged, and skips private stations', () => {
    const list = parseOsm([osm(3, 40.2, 44.5, { operator: 'Թիմ էներջի' }), osm(4, 40.3, 44.6, { access: 'private' })])
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ operator: 'Team Energy', maxKw: null, dc: null, connectors: [] })
  })
})

describe('parseOcm', () => {
  const poi = (over: Record<string, unknown> = {}) => ({
    ID: 311697,
    AddressInfo: { Title: 'Team Energy Dalma', Latitude: 40.18, Longitude: 44.49 },
    OperatorInfo: { Title: 'Team Energy' },
    NumberOfPoints: 4,
    StatusType: { IsOperational: true },
    Connections: [
      { PowerKW: 240, Quantity: 2, CurrentTypeID: 30, ConnectionTypeID: 33 },
      { PowerKW: 22, Quantity: 2, CurrentTypeID: 20, ConnectionTypeID: 25 },
    ],
    ...over,
  })

  it('reads power, connectors and points', () => {
    const [c] = parseOcm([poi()])
    expect(c).toMatchObject({ id: 'ocm-311697', name: 'Team Energy Dalma', operator: 'Team Energy', maxKw: 240, dc: true, connectors: ['CCS2', 'Type 2'], points: 4 })
  })

  it('skips stations that are not operational', () => {
    expect(parseOcm([poi({ StatusType: { IsOperational: false } })])).toEqual([])
  })
})

describe('mergeChargers', () => {
  it('treats entries within 60 m as one station and keeps the one with power', () => {
    const fromOsm = parseOsm([osm(5, 40.18001, 44.49001, { operator: 'Team Energy', 'socket:gb_dc': '1' })])
    const fromOcm = parseOcm([{ ID: 9, AddressInfo: { Title: 'Dalma', Latitude: 40.18, Longitude: 44.49 }, Connections: [{ PowerKW: 240, ConnectionTypeID: 33, CurrentTypeID: 30 }] }])
    const merged = mergeChargers(fromOsm, fromOcm)
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ id: 'ocm-9', maxKw: 240, operator: 'Team Energy' })
    expect(merged[0].connectors.sort()).toEqual(['CCS2', 'GB/T DC'])
  })

  it('keeps stations that are far apart', () => {
    const list = parseOsm([osm(6, 40.18, 44.49, {}), osm(7, 40.19, 44.49, {})])
    expect(mergeChargers(list)).toHaveLength(2)
  })
})

describe('GET /api/chargers', () => {
  beforeEach(async () => {
    await resetDatabase()
    resetChargerFeed()
  })
  afterEach(() => vi.unstubAllGlobals())
  afterAll(() => sql.end())

  const stubUpstream = (handler: () => Response) => {
    const real = globalThis.fetch
    const upstream = vi.fn(handler)
    vi.stubGlobal('fetch', (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => (String(input).includes('overpass') || String(input).includes('maps.mail.ru') ? Promise.resolve(upstream()) : real(input, init)))
    return upstream
  }

  it('serves the stations, then answers from its cache', async () => {
    const upstream = stubUpstream(() => Response.json({ elements: [osm(1, 40.19, 44.54, { operator: 'EVAN', 'socket:type2': '1', 'socket:type2:output': '22 kW' })] }))
    const first = await client().get('/api/chargers')
    expect(first.status).toBe(200)
    expect(first.json.sources).toEqual(['OpenStreetMap'])
    expect(first.json.chargers).toHaveLength(1)
    expect(first.json.chargers[0]).toMatchObject({ operator: 'EVAN', maxKw: 22 })
    await client().get('/api/chargers')
    expect(upstream).toHaveBeenCalledTimes(1)
  })

  it('keeps the last good snapshot when the source is down after a restart', async () => {
    stubUpstream(() => Response.json({ elements: [osm(1, 40.19, 44.54, { operator: 'EVAN' })] }))
    await client().get('/api/chargers')
    resetChargerFeed() // simulates a server restart: memory is empty, the database still has the snapshot
    stubUpstream(() => new Response('busy', { status: 504 }))
    const again = await client().get('/api/chargers')
    expect(again.json.chargers).toHaveLength(1)
  })
})
