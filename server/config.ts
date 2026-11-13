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

export const config = {
  port: Number(env.PORT) || 8787,
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
  sessionDays: 90,
}

/** Email codes work in production only with a provider; in dev the code is printed to the server log. */
export const emailCodesEnabled = () => !!(config.email.resendApiKey && config.email.from) || !config.production
export const googleEnabled = () => !!(config.google.clientId && config.google.clientSecret)
