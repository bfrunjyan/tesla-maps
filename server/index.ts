// Server entry (npm start): apply migrations, then listen.
import { serve } from '@hono/node-server'
import { app } from './app.ts'
import { config, emailCodesEnabled, googleEnabled } from './config.ts'
import { migrate } from './db.ts'

await migrate()
serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
  console.log(`[server] listening on :${info.port} (${config.appUrl})`)
  console.log(`[server] sign-in: password, QR${emailCodesEnabled() ? ', email code' : ''}${googleEnabled() ? ', Google' : ''}`)
})
