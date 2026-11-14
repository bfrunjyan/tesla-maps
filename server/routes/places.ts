import { Hono } from 'hono'
import { sql } from '../db.ts'
import { requireUser, type AppEnv } from '../lib/session.ts'

/** Home, Work, favorites and recent destinations for the signed-in user. */
export const places = new Hono<AppEnv>()
places.use('*', requireUser)

const CATEGORIES = new Set(['address', 'charging', 'food', 'attraction', 'poi', 'home', 'work', 'pin'])
const MAX_RECENTS = 25
const MAX_FAVORITES = 200

interface PlaceIn {
  id: string
  name: string
  address: string
  lon: number
  lat: number
  category: string | null
}

export function parsePlace(v: unknown): PlaceIn | null {
  if (!v || typeof v !== 'object') return null
  const p = v as Record<string, unknown>
  const lon = Number(p.lon)
  const lat = Number(p.lat)
  if (typeof p.id !== 'string' || !p.id || p.id.length > 200) return null
  if (typeof p.name !== 'string' || !p.name.trim()) return null
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return null
  return {
    id: p.id,
    name: p.name.trim().slice(0, 200),
    address: typeof p.address === 'string' ? p.address.slice(0, 300) : '',
    lon,
    lat,
    category: typeof p.category === 'string' && CATEGORIES.has(p.category) ? p.category : null,
  }
}

type Row = { kind: string; place_id: string; name: string; address: string; lon: number; lat: number; category: string | null }
const toPlace = (r: Row) => ({ id: r.place_id, name: r.name, address: r.address, lon: r.lon, lat: r.lat, ...(r.category ? { category: r.category } : {}) })

async function loadAll(userId: string) {
  const rows = await sql<Row[]>`
    SELECT kind, place_id, name, address, lon, lat, category FROM places
    WHERE user_id = ${userId} ORDER BY updated_at DESC`
  const home = rows.find((r) => r.kind === 'home')
  const work = rows.find((r) => r.kind === 'work')
  return {
    home: home ? toPlace(home) : null,
    work: work ? toPlace(work) : null,
    favorites: rows.filter((r) => r.kind === 'favorite').map(toPlace),
    recents: rows.filter((r) => r.kind === 'recent').slice(0, MAX_RECENTS).map(toPlace),
  }
}

async function upsert(userId: string, kind: string, p: PlaceIn) {
  if (kind === 'home' || kind === 'work') {
    await sql`
      INSERT INTO places (user_id, kind, place_id, name, address, lon, lat, category)
      VALUES (${userId}, ${kind}, ${p.id}, ${p.name}, ${p.address}, ${p.lon}, ${p.lat}, ${p.category})
      ON CONFLICT (user_id, kind) WHERE kind IN ('home', 'work')
      DO UPDATE SET place_id = EXCLUDED.place_id, name = EXCLUDED.name, address = EXCLUDED.address,
                    lon = EXCLUDED.lon, lat = EXCLUDED.lat, category = EXCLUDED.category, updated_at = now()`
  } else {
    await sql`
      INSERT INTO places (user_id, kind, place_id, name, address, lon, lat, category)
      VALUES (${userId}, ${kind}, ${p.id}, ${p.name}, ${p.address}, ${p.lon}, ${p.lat}, ${p.category})
      ON CONFLICT (user_id, kind, place_id) WHERE kind IN ('favorite', 'recent')
      DO UPDATE SET name = EXCLUDED.name, address = EXCLUDED.address, lon = EXCLUDED.lon, lat = EXCLUDED.lat,
                    category = EXCLUDED.category, updated_at = now()`
  }
}

async function trimRecents(userId: string) {
  await sql`
    DELETE FROM places WHERE user_id = ${userId} AND kind = 'recent' AND id NOT IN (
      SELECT id FROM places WHERE user_id = ${userId} AND kind = 'recent' ORDER BY updated_at DESC LIMIT ${MAX_RECENTS})`
}

places.get('/', async (c) => c.json(await loadAll(c.get('user')!.id)))

places.put('/:kind{home|work}', async (c) => {
  const userId = c.get('user')!.id
  const kind = c.req.param('kind')
  const b = (await c.req.json().catch(() => null)) as { place?: unknown } | null
  if (b?.place === null) {
    await sql`DELETE FROM places WHERE user_id = ${userId} AND kind = ${kind}`
    return c.json({ ok: true })
  }
  const p = parsePlace(b?.place)
  if (!p) return c.json({ error: 'Invalid place' }, 400)
  await upsert(userId, kind, p)
  return c.json({ ok: true })
})

places.post('/favorites', async (c) => {
  const userId = c.get('user')!.id
  const p = parsePlace(await c.req.json().catch(() => null))
  if (!p) return c.json({ error: 'Invalid place' }, 400)
  const [{ count }] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM places WHERE user_id = ${userId} AND kind = 'favorite'`
  if (count >= MAX_FAVORITES) return c.json({ error: 'You’ve reached the favorites limit.' }, 409)
  await upsert(userId, 'favorite', p)
  return c.json({ ok: true })
})

places.delete('/favorites/:placeId', async (c) => {
  await sql`DELETE FROM places WHERE user_id = ${c.get('user')!.id} AND kind = 'favorite' AND place_id = ${c.req.param('placeId')}`
  return c.json({ ok: true })
})

places.post('/recents', async (c) => {
  const userId = c.get('user')!.id
  const p = parsePlace(await c.req.json().catch(() => null))
  if (!p) return c.json({ error: 'Invalid place' }, 400)
  await upsert(userId, 'recent', p)
  await trimRecents(userId)
  return c.json({ ok: true })
})

places.delete('/recents', async (c) => {
  await sql`DELETE FROM places WHERE user_id = ${c.get('user')!.id} AND kind = 'recent'`
  return c.json({ ok: true })
})

/**
 * Merge places saved on this device before signing in. Account data wins for
 * Home/Work; favorites and recents are combined.
 */
places.post('/import', async (c) => {
  const userId = c.get('user')!.id
  const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>
  const current = await loadAll(userId)
  const home = parsePlace(b.home)
  const work = parsePlace(b.work)
  if (home && !current.home) await upsert(userId, 'home', home)
  if (work && !current.work) await upsert(userId, 'work', work)
  const list = (v: unknown) => (Array.isArray(v) ? v.slice(0, 100).map(parsePlace).filter((p): p is PlaceIn => !!p) : [])
  for (const p of list(b.favorites).slice(0, Math.max(0, MAX_FAVORITES - current.favorites.length))) await upsert(userId, 'favorite', p)
  // Oldest first so the most recent local item ends up newest.
  for (const p of list(b.recents).reverse()) {
    if (!current.recents.some((r) => r.id === p.id)) await upsert(userId, 'recent', p)
  }
  await trimRecents(userId)
  return c.json(await loadAll(userId))
})
