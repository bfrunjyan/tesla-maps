import { Hono } from 'hono'
import { sql } from '../db.ts'
import { requireUser, type AppEnv } from '../lib/session.ts'

/** The car the driver chose (model, year, version), synced across their devices. */
export const vehicle = new Hono<AppEnv>()
vehicle.use('*', requireUser)

const ID = /^[a-z0-9-]{1,40}$/

vehicle.get('/', async (c) => {
  const [row] = await sql<{ model: string; year: number; trim: string }[]>`
    SELECT model, year, trim FROM vehicles WHERE user_id = ${c.get('user')!.id}`
  return c.json({ vehicle: row ?? null })
})

vehicle.put('/', async (c) => {
  const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>
  const userId = c.get('user')!.id
  if (b.vehicle === null) {
    await sql`DELETE FROM vehicles WHERE user_id = ${userId}`
    return c.json({ ok: true })
  }
  const v = (b.vehicle ?? {}) as Record<string, unknown>
  const year = Number(v.year)
  if (typeof v.model !== 'string' || !ID.test(v.model) || typeof v.trim !== 'string' || !ID.test(v.trim) || !Number.isInteger(year) || year < 2008 || year > 2100) {
    return c.json({ error: 'Invalid vehicle' }, 400)
  }
  await sql`
    INSERT INTO vehicles (user_id, model, year, trim) VALUES (${userId}, ${v.model}, ${year}, ${v.trim})
    ON CONFLICT (user_id) DO UPDATE SET model = EXCLUDED.model, year = EXCLUDED.year, trim = EXCLUDED.trim, updated_at = now()`
  return c.json({ ok: true })
})
