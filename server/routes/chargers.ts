import { Hono } from 'hono'
import { getChargerFeed } from '../lib/chargers.ts'
import type { AppEnv } from '../lib/session.ts'

/** All charging stations (a few hundred); the app filters by distance and power. */
export const chargers = new Hono<AppEnv>()

chargers.get('/', async (c) => c.json(await getChargerFeed()))
