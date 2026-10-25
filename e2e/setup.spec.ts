import { expect, test } from '@playwright/test'

/**
 * The first run, on a deployment with no accounts at all (task 154.4).
 *
 * This spec runs against the instance on port 4177, whose database is deleted on every start: there
 * is no other way to be in the one state the first-run surface exists for. It deliberately has no
 * development switch — the first administrator is made with a password, which is the point.
 */

const ORIGIN = 'http://localhost:4177'

// Serial: the second test asks what the first one made. Two workers would race for the one
// administrator a fresh instance can have.
test.describe.configure({ mode: 'serial' })
const PASSWORD = 'correct horse battery staple'

test('a fresh instance offers the first administrator, and closes behind them', async ({ page, request }) => {
  // Nothing has signed in, so the only door is the installation.
  expect(await (await request.get(`${ORIGIN}/api/auth/providers`)).json()).toMatchObject({ setup: true })

  await page.goto(`${ORIGIN}/app`)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()

  // The surface says what it is, and there are no default credentials to fall back on.
  await expect(page.getByText('This instance has no accounts yet')).toBeVisible()

  await page.getByLabel('Your name').fill('Ada Lovelace')
  await page.getByLabel('Email address').fill('ada@example.com')
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create the administrator' }).click()

  // Signed in, and looking at a workspace that is empty — a fresh deployment has no boards, which is
  // the honest state after an install rather than a demo board seeded behind the administrator's back.
  await expect(page.getByRole('button', { name: /Ada Lovelace/ })).toBeVisible()
  await expect(page.locator('[data-workflow="cards"]')).toHaveCount(0)
  const workspace = await (await page.request.get(`${ORIGIN}/api/workspace`)).json()
  expect(workspace.boards).toEqual([])

  // `page.request` carries this browser's cookie; the `request` fixture is a context of its own.
  const session = await (await page.request.get(`${ORIGIN}/api/auth/session`)).json()
  expect(session.instanceRole).toBe('admin')
  expect(session.workspaces[0].role).toBe('admin')

  // The installation is closed: there is an account now, so there is nothing to set up.
  expect(await (await request.get(`${ORIGIN}/api/auth/providers`)).json()).toMatchObject({ setup: false })

  // And the password it took is the password that signs in, from a browser with no cookie.
  const fresh = await request.post(`${ORIGIN}/api/auth/password`, {
    data: { email: 'ada@example.com', password: PASSWORD },
  })
  expect(fresh.status()).toBe(200)
})

test('the first administrator is offered once, and the instance refuses a second', async ({ request }) => {
  // The previous test created it on this database, and the server outlives the test.
  const again = await request.post(`${ORIGIN}/api/auth/setup`, {
    data: { name: 'Somebody Else', email: 'other@example.com', password: PASSWORD },
  })
  expect(again.status()).toBe(409)
})
