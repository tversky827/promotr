import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    // The HTTP end-to-end suite boots a real server, so it needs longer.
    testTimeout: 60_000,
    setupFiles: ['tests/setup.ts'],
    hookTimeout: 60_000,
    // Integration tests share one Postgres database, so they must not run in
    // parallel across workers.
    fileParallelism: false,
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
