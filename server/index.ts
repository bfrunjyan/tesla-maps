// Server entry (npm start): apply migrations, then listen.
import { serve } from '@hono/node-server'
import { app } from './app.ts'
import { config, emailCodesEnabled, googleEnabled, teslaEnabled } from './config.ts'
import { migrate } from './db.ts'

await migrate()
serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
  console.log(`[server] listening on :${info.port} (${config.appUrl})`)
  console.log(`[server] sign-in: password, QR${emailCodesEnabled() ? ', email code' : ''}${googleEnabled() ? ', Google' : ''}`)
  console.log(`[server] Connect Tesla: ${!teslaEnabled() ? 'off (no TESLA_CLIENT_ID / TESLA_CLIENT_SECRET)' : config.tesla.fake ? 'on, with the local stand-in for Tesla' : `on${config.tesla.publicKey ? '' : ' (TESLA_PUBLIC_KEY is not set)'}`}`)
})
