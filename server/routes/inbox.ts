import { Hono } from 'hono'
import { sql } from '../db.ts'
import { requireUser, type AppEnv } from '../lib/session.ts'
import { parsePlace } from './places.ts'

/**
 * "Send to car": a place picked on the phone waits here until the car, signed in to the
 * same account, picks it up. Only the newest one is kept, for a day.
 */
export const inbox = new Hono<AppEnv>()
inbox.use('*', requireUser)

const KEEP_HOURS = 24
const DEVICE = /^[A-Za-z0-9-]{8,64}$/

/** Sends a place to the car (replacing any not yet picked up). */
inbox.post('/', async (c) => {
  const body = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>
  const place = parsePlace(body.place)
  if (!place) return c.json({ error: 'Invalid place' }, 400)
  const device = typeof body.device === 'string' && DEVICE.test(body.device) ? body.device : null
  await sql`
    INSERT INTO car_inbox (user_id, place, from_device, sent_at, delivered_at) VALUES (${c.get('user')!.id}, ${sql.json(place)}, ${device}, now(), NULL)
    ON CONFLICT (user_id) DO UPDATE SET place = EXCLUDED.place, from_device = EXCLUDED.from_device, sent_at = now(), delivered_at = NULL`
  return c.json({ ok: true })
})

/** The place waiting for the car, if any (sent in the last day, not yet shown, not by this device). */
inbox.get('/', async (c) => {
  const device = c.req.query('device') ?? ''
  const [row] = await sql<{ place: unknown; sent_at: Date }[]>`
    SELECT place, sent_at FROM car_inbox
    WHERE user_id = ${c.get('user')!.id} AND delivered_at IS NULL AND sent_at > now() - make_interval(hours => ${KEEP_HOURS})
      AND (${device}::text = '' OR from_device IS DISTINCT FROM ${device})`
  return c.json(row ? { place: row.place, sentAt: row.sent_at.toISOString() } : { place: null })
})

/** The car showed it: don't show it again (the car says which one, so a newer one isn't lost). */
inbox.post('/seen', async (c) => {
  const body = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>
  const sentAt = typeof body.sentAt === 'string' ? Date.parse(body.sentAt) : Number.NaN
  if (!Number.isFinite(sentAt)) return c.json({ error: 'Invalid sentAt' }, 400)
  await sql`
    UPDATE car_inbox SET delivered_at = now()
    WHERE user_id = ${c.get('user')!.id} AND delivered_at IS NULL AND sent_at <= ${new Date(sentAt + 1)}`
  return c.json({ ok: true })
})
