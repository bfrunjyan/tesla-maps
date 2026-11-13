/** Runtime configuration from environment variables (Railway → Variables). */
const env = process.env

function bool(v: string | undefined) {
  return v === '1' || v === 'true'
}

const appUrl = (env.APP_URL ?? `http://localhost:${env.PORT ?? 8787}`).replace(/\/$/, '')
const deployed = !!env.RAILWAY_ENVIRONMENT || env.NODE_ENV === 'production' || appUrl.startsWith('https://')

// Fail fast with a clear message instead of a connection error to a local default.
if (deployed && !env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. On Railway, add a Postgres service and reference its DATABASE_URL in this service’s Variables.')
}
if (env.RAILWAY_ENVIRONMENT && !env.APP_URL) {
  console.warn('[config] APP_URL is not set; set it to the public https:// URL (needed for Google sign-in and secure cookies).')
}

// Local development only: TESLA_FAKE=1 swaps Tesla for the stand-in in server/dev/fakeTesla.ts.
const port = Number(env.PORT) || 8787
const fakeTesla = !deployed && bool(env.TESLA_FAKE)
const self = `http://localhost:${port}/api/dev/tesla`
/** Tesla's addresses can be replaced only outside production (tests, the local stand-in). */
const teslaUrl = (override: string | undefined, fake: string, real: string) => (!deployed && override ? override : fakeTesla ? fake : real)

export const config = {
  port,
  /** Public URL of the app, used for QR links and the Google redirect. */
  appUrl,
  /** Railway's Postgres plugin provides DATABASE_URL. */
  databaseUrl: env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:54340/teslamaps',
  /** Cookies get the Secure flag when served over HTTPS. */
  secureCookies: appUrl.startsWith('https://'),
  production: deployed,
  /** Trust X-Forwarded-For from the platform proxy (Railway). */
  trustProxy: env.TRUST_PROXY ? bool(env.TRUST_PROXY) : appUrl.startsWith('https://'),

  email: {
    resendApiKey: env.RESEND_API_KEY ?? '',
    from: env.EMAIL_FROM ?? '',
  },
  google: {
    clientId: env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
  },
  chargers: {
    /** ISO country codes whose charging stations are loaded. */
    countries: (env.CHARGER_COUNTRIES ?? 'AM').split(',').map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)),
    /** Optional: free key from openchargemap.org adds power and connector data. */
    ocmApiKey: env.OCM_API_KEY ?? '',
  },
  /** Connect Tesla: reads charge level, range and charging state from the driver's car (Tesla Fleet API). */
  tesla: {
    clientId: env.TESLA_CLIENT_ID ?? (fakeTesla ? 'fake-client' : ''),
    clientSecret: env.TESLA_CLIENT_SECRET ?? (fakeTesla ? 'fake-secret' : ''),
    /** PEM public key Tesla fetches from /.well-known/appspecific/com.tesla.3p.public-key.pem. */
    publicKey: (env.TESLA_PUBLIC_KEY ?? '').replace(/\\n/g, '\n').trim(),
    authUrl: teslaUrl(env.TESLA_AUTH_URL, `${appUrl}/api/dev/tesla/authorize`, 'https://auth.tesla.com/oauth2/v3/authorize'),
    tokenUrl: teslaUrl(env.TESLA_TOKEN_URL, `${self}/token`, 'https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token'),
    /** Starting point; each driver's own region is looked up after sign-in. */
    apiBase: teslaUrl(env.TESLA_API_URL, self, 'https://fleet-api.prd.na.vn.cloud.tesla.com'),
    fake: fakeTesla,
    /** Most readings per driver per day. Tesla bills each one (about $0.002). */
    dailyReads: Number(env.TESLA_DAILY_READS) || 60,
  },
  sessionDays: 90,
}

/** Email codes work in production only with a provider; in dev the code is printed to the server log. */
export const emailCodesEnabled = () => !!(config.email.resendApiKey && config.email.from) || !config.production
export const googleEnabled = () => !!(config.google.clientId && config.google.clientSecret)
export const teslaEnabled = () => !!(config.tesla.clientId && config.tesla.clientSecret)
