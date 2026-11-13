// Runs before each API test file: point the server at the throwaway test database.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:54340/teslamaps_test'
process.env.APP_URL = 'http://localhost:5174'
process.env.NODE_ENV = 'test'
delete process.env.RESEND_API_KEY
delete process.env.EMAIL_FROM
delete process.env.RAILWAY_ENVIRONMENT
// Connect Tesla talks to the stand-in in server/dev/fakeTesla.ts (see server/test/tesla.test.ts).
process.env.TESLA_CLIENT_ID = 'test-client'
process.env.TESLA_CLIENT_SECRET = 'test-secret'
process.env.TESLA_AUTH_URL = 'http://tesla.test/authorize'
process.env.TESLA_TOKEN_URL = 'http://tesla.test/token'
process.env.TESLA_API_URL = 'http://tesla.test'
delete process.env.TESLA_FAKE
delete process.env.TESLA_PUBLIC_KEY
delete process.env.TESLA_DAILY_READS
