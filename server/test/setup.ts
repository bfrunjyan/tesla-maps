// Runs before each API test file: point the server at the throwaway test database.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:54340/teslamaps_test'
process.env.APP_URL = 'http://localhost:5174'
process.env.NODE_ENV = 'test'
delete process.env.RESEND_API_KEY
delete process.env.EMAIL_FROM
delete process.env.RAILWAY_ENVIRONMENT
