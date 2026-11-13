import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: { name: 'unit', include: ['src/**/*.test.ts'], environment: 'node' },
      },
      {
        test: {
          name: 'api',
          include: ['server/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['server/test/setup.ts'],
          fileParallelism: false,
          testTimeout: 20000,
          hookTimeout: 30000,
        },
      },
    ],
  },
})
