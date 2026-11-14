// Busy Yerevan junctions without lane data in OpenStreetMap.
//
// Plans routes between well-known places across the city (open routing server, with
// lanes), keeps the turns that come with no lane guidance, and ranks the junctions by how
// many routes turn there: those are where adding OpenStreetMap "turn:lanes" helps most.
//
//   node scripts/lane-gaps.mjs            # prints a Markdown list
//   node scripts/lane-gaps.mjs > docs/lane-gaps.md
//
// Light use of a free public server: one request at a time, a pause between them.

const VALHALLA = 'https://valhalla1.openstreetmap.de/route'
const PLACES = {
  'Republic Square': [44.5126, 40.1777],
  Cascade: [44.5157, 40.1912],
  'Opera Theatre': [44.5149, 40.1858],
  'Komitas / Baghramyan': [44.5032, 40.2048],
  'Sasuntsi David station': [44.5255, 40.1563],
  'Zvartnots Airport': [44.3959, 40.1473],
  'Yerevan Mall': [44.4874, 40.1712],
  'Dalma Garden Mall': [44.4801, 40.1846],
  'Kievyan bridge': [44.4977, 40.1934],
  'Victory bridge': [44.5005, 40.1776],
  'Erebuni': [44.532, 40.14],
  'Nor Nork': [44.574, 40.198],
  Davtashen: [44.4935, 40.2283],
  Ajapnyak: [44.465, 40.205],
  Malatia: [44.465, 40.16],
  'Tsitsernakaberd': [44.4904, 40.1856],
}
const MIN_ROUTES = 2
const TURNS = new Set([9, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 21, 23, 24])

function decode(str) {
  let index = 0, lat = 0, lon = 0
  const out = []
  while (index < str.length) {
    for (const which of [0, 1]) {
      let b, shift = 0, result = 0
      do {
        b = str.charCodeAt(index++) - 63
        result |= (b & 0x1f) << shift
        shift += 5
      } while (b >= 0x20)
      const d = result & 1 ? ~(result >> 1) : result >> 1
      if (which === 0) lat += d
      else lon += d
    }
    out.push([lon / 1e6, lat / 1e6])
  }
  return out
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const names = Object.keys(PLACES)
const junctions = new Map()
let routes = 0, turns = 0, withLanes = 0

for (let i = 0; i < names.length; i++) {
  for (let j = 0; j < names.length; j++) {
    if (i === j || (i + j) % 3 !== 0) continue // a spread of pairs, not all 240
    const [a, b] = [PLACES[names[i]], PLACES[names[j]]]
    const res = await fetch(VALHALLA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'lane-gap-check/1.0' },
      body: JSON.stringify({ locations: [{ lon: a[0], lat: a[1] }, { lon: b[0], lat: b[1] }], costing: 'auto', turn_lanes: true }),
    }).catch(() => null)
    await sleep(400)
    const data = await res?.json().catch(() => null)
    if (!data?.trip) continue
    routes++
    const leg = data.trip.legs[0]
    const shape = decode(leg.shape)
    let from = null
    for (const m of leg.maneuvers) {
      const was = from
      from = (m.street_names ?? [])[0] ?? from
      if (!TURNS.has(m.type)) continue
      turns++
      if (m.lanes?.length) {
        withLanes++
        continue
      }
      const [lon, lat] = shape[m.begin_shape_index]
      const key = `${lon.toFixed(4)},${lat.toFixed(4)}`
      const j2 = junctions.get(key) ?? { lon, lat, routes: new Set(), streets: new Set(), from: new Set() }
      j2.routes.add(`${names[i]} → ${names[j]}`)
      for (const s of m.street_names ?? []) j2.streets.add(s)
      if (was) j2.from.add(was)
      junctions.set(key, j2)
    }
  }
}

const list = [...junctions.values()].filter((j) => j.routes.size >= MIN_ROUTES).sort((x, y) => y.routes.size - x.routes.size)
console.log(`# Yerevan junctions without lane data\n`)
console.log(`From ${routes} routes between ${names.length} places: ${turns} turns, ${withLanes} with lanes (${Math.round((100 * withLanes) / Math.max(1, turns))}%). Junctions where at least ${MIN_ROUTES} routes turn without lane data, busiest first. Adding OpenStreetMap \`turn:lanes\` on the roads leading into them gives Mapic lane guidance there.\n`)
console.log('| # | From | Turning onto | Routes | Edit |')
console.log('|---|---|---|---|---|')
list.slice(0, 40).forEach((j, n) => {
  const onto = [...j.streets][0] ?? 'slip road'
  const from = [...j.from][0] ?? '–'
  console.log(`| ${n + 1} | ${from} | ${onto} | ${j.routes.size} | [open](https://www.openstreetmap.org/edit#map=19/${j.lat.toFixed(5)}/${j.lon.toFixed(5)}) |`)
})
