import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests, against the build that ships.
 *
 * The dev server is deliberately not used: what a person gets is `dist/`, and a bug that only
 * appears after bundling is exactly the kind this suite is for. `webServer` builds and serves it,
 * so `npm run test:e2e` is one command and leaves nothing running behind it.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  // A device's viewport is part of the device, so it has to be overridden after the spread: the
  // board puts the cards workflow below the initiatives one, and a drag needs both ends visible.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1200 } } }],
  webServer: [
    {
      command: 'npm run build && npx vite preview --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      /**
       * The self-hosted entry, for the flows that need an account: a real Node process over a real
       * SQLite file, with the development identity switch turned on by name. It is the same build
       * the first server serves — proof that the two entries are one application.
       */
      command:
        'mkdir -p node_modules/.tmp && rm -f node_modules/.tmp/e2e.db && AUTH_DEV=1 PORT=4174 DB_PATH=node_modules/.tmp/e2e.db STATIC_DIR=dist npm run --silent server',
      url: 'http://localhost:4174/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
