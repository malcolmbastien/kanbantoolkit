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
      // The build, served by a forty-line host that implements the deployment's routing contract:
      // `/app` is the app, an unknown path is the 404 page with a 404. (Vite's preview answers every
      // unknown path with a single page, which is exactly what task 151 removed.)
      command: 'npm run build && PORT=4173 node scripts/serve-dist.mjs',
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
    {
      /**
       * An instance of its own for the one spec that **closes the account** (task 126): a test that
       * deletes everything cannot share a database with tests that expect something to be there.
       * It is also the instance that names its own workspace (`WORKSPACE_NAME`), which is how the
       * e2e proves the install — rather than a form — gives the team its name (task 163).
       */
      command:
        'mkdir -p node_modules/.tmp && rm -f node_modules/.tmp/e2e-account.db && AUTH_DEV=1 WORKSPACE_NAME="Team Atlas" PORT=4176 DB_PATH=node_modules/.tmp/e2e-account.db STATIC_DIR=dist npm run --silent server',
      url: 'http://localhost:4176/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      /**
       * The same entry with the socket switched off — an instance whose live channel is the poll.
       * R5 of task 118.5 asks CI to exercise the fallback rather than only the push, and this is
       * how: the same application, the same routes, one environment variable apart.
       */
      command:
        'mkdir -p node_modules/.tmp && rm -f node_modules/.tmp/e2e-poll.db && AUTH_DEV=1 LIVE=0 PORT=4175 DB_PATH=node_modules/.tmp/e2e-poll.db STATIC_DIR=dist npm run --silent server',
      url: 'http://localhost:4175/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      /**
       * A deployment with no accounts at all — the only state the first run is reachable in
       * (task 154.4). Its database is deleted on every start, so the instance really is fresh, and
       * it deliberately has no `AUTH_DEV`: the first administrator is made with a password.
       */
      command:
        'mkdir -p node_modules/.tmp && rm -f node_modules/.tmp/e2e-setup.db && WORKSPACE_NAME="Team Atlas" PORT=4177 DB_PATH=node_modules/.tmp/e2e-setup.db STATIC_DIR=dist npm run --silent server',
      url: 'http://localhost:4177/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      /**
       * A deployment with a mail relay — the console one, writing to a file the test can read
       * (task 154.7). The magic-link door only exists where mail does, so proving it in a browser
       * needs an instance that has one; and a test that parsed a real mailbox would not be a test.
       */
      command:
        'mkdir -p node_modules/.tmp && rm -f node_modules/.tmp/e2e-mail.db node_modules/.tmp/mail.log && MAIL_CONSOLE=1 WORKSPACE_NAME="Team Atlas" PORT=4178 DB_PATH=node_modules/.tmp/e2e-mail.db STATIC_DIR=dist npm run --silent server > node_modules/.tmp/mail.log 2>&1',
      url: 'http://localhost:4178/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
