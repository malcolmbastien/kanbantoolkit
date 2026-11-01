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
        // `PROJECT_URL` is the static host, because the terms and privacy pages an instance links are
        // the project's, served there (task 173).
        'mkdir -p node_modules/.tmp && rm -f node_modules/.tmp/e2e.db && AUTH_DEV=1 PROJECT_URL=http://localhost:4173 PORT=4174 DB_PATH=node_modules/.tmp/e2e.db STATIC_DIR=dist npm run --silent server',
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
       * An instance of its own for the live channel's socket.
       *
       * The channel needs a workspace with a card in it, and a *workspace* is one per instance — so
       * sharing the instance the account specs work against would have this test replace the design
       * they are reading, and the two would fail each other at random. One instance per spec file
       * that writes a whole workspace.
       */
      command:
        'mkdir -p node_modules/.tmp && rm -f node_modules/.tmp/e2e-live.db && AUTH_DEV=1 PORT=4179 DB_PATH=node_modules/.tmp/e2e-live.db STATIC_DIR=dist npm run --silent server',
      url: 'http://localhost:4179/api/health',
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
       * An instance of its own for the workspace's words (task 178). The spec writes a type, a
       * template and an objective, and a reload must find them — which means the vocabulary it
       * replaces is nobody else's.
       */
      command:
        'mkdir -p node_modules/.tmp && rm -f node_modules/.tmp/e2e-vocabulary.db && AUTH_DEV=1 PORT=4180 DB_PATH=node_modules/.tmp/e2e-vocabulary.db STATIC_DIR=dist npm run --silent server',
      url: 'http://localhost:4180/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      /**
       * An instance of its own for outbound webhooks (task 186). The spec creates an endpoint that
       * points at a listener inside the test process, so a delivery can be proved end to end without
       * sending anything to the internet.
       */
      command:
        'mkdir -p node_modules/.tmp && rm -f node_modules/.tmp/e2e-webhooks.db && AUTH_DEV=1 PORT=4181 DB_PATH=node_modules/.tmp/e2e-webhooks.db STATIC_DIR=dist npm run --silent server',
      url: 'http://localhost:4181/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      /**
       * An instance of its own for history read on demand (task 192): a board, a card, a note and a
       * move, then a second browser with no local history asking where they went. Two browsers over
       * one database is the point — one of them never held the history at all.
       */
      command:
        'mkdir -p node_modules/.tmp && rm -f node_modules/.tmp/e2e-history.db && AUTH_DEV=1 WORKSPACE_NAME="Team Atlas" PORT=4182 DB_PATH=node_modules/.tmp/e2e-history.db STATIC_DIR=dist npm run --silent server',
      url: 'http://localhost:4182/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      /**
       * An instance of its own for sessions (task 144). The spec opens the instance's door for a
       * domain in `beforeAll`, and the account spec changes the same setting on the shared
       * instance — two files racing over one allowed-domain list made sign-in fail at random.
       * One instance per file keeps the door each test opens its own.
       */
      command:
        'mkdir -p node_modules/.tmp && rm -f node_modules/.tmp/e2e-sessions.db && AUTH_DEV=1 WORKSPACE_NAME="Team Atlas" PORT=4183 DB_PATH=node_modules/.tmp/e2e-sessions.db STATIC_DIR=dist npm run --silent server',
      url: 'http://localhost:4183/api/health',
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
