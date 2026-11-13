// One-off setup for Connect Tesla: registers this app's domain with Tesla in each
// region, so Tesla accepts drivers' sign-ins. Run it once after the public key is
// live at https://<your domain>/.well-known/appspecific/com.tesla.3p.public-key.pem
//
//   TESLA_CLIENT_ID=… TESLA_CLIENT_SECRET=… APP_URL=https://your.domain npm run tesla:register
//
// It prints what Tesla answered for each region and changes nothing in Mapic.
const { TESLA_CLIENT_ID: id, TESLA_CLIENT_SECRET: secret, APP_URL: appUrl } = process.env
if (!id || !secret || !appUrl?.startsWith('https://')) {
  console.error('Set TESLA_CLIENT_ID, TESLA_CLIENT_SECRET and APP_URL (https://…) first.')
  process.exit(1)
}
const domain = new URL(appUrl).hostname
const TOKEN_URL = 'https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token'
const REGIONS = {
  'North America, Asia-Pacific': 'https://fleet-api.prd.na.vn.cloud.tesla.com',
  'Europe, Middle East, Africa': 'https://fleet-api.prd.eu.vn.cloud.tesla.com',
}

const key = await fetch(`https://${domain}/.well-known/appspecific/com.tesla.3p.public-key.pem`)
if (!key.ok || !(await key.text()).includes('BEGIN PUBLIC KEY')) {
  console.error(`The public key is not live on https://${domain} yet (set TESLA_PUBLIC_KEY and deploy first).`)
  process.exit(1)
}

let failed = false
for (const [name, base] of Object.entries(REGIONS)) {
  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret, scope: 'openid vehicle_device_data', audience: base }),
  })
  const token = (await tokenRes.json().catch(() => null))?.access_token
  if (!token) {
    console.error(`${name}: Tesla refused the client ID or secret (HTTP ${tokenRes.status}).`)
    failed = true
    continue
  }
  const res = await fetch(`${base}/api/1/partner_accounts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain }),
  })
  const body = await res.json().catch(() => null)
  if (res.ok) console.log(`${name}: registered ${domain}`)
  else {
    console.error(`${name}: not registered (HTTP ${res.status}) ${JSON.stringify(body?.error ?? body)}`)
    failed = true
  }
}
process.exit(failed ? 1 : 0)
