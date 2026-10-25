import { expect, test } from '@playwright/test'

/**
 * The first run, on a deployment with no accounts at all (task 154.4).
 *
 * This spec runs against the instance on port 4177, whose database is deleted on every start: there
 * is no other way to be in the one state the first-run surface exists for. It deliberately has no
 * development switch — the first administrator is made with a password, which is the point.
 */

const ORIGIN = 'http://localhost:4177'

// Serial, and never retried: every test here builds on the state the one before it made — one
// administrator, one invitation, one spent link — so a retry would run against a database that has
// already moved. A failure is reported once, against the state it actually met.
test.describe.configure({ mode: 'serial', retries: 0 })
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

test('an invitation is where the second person chooses a password', async ({ page, browser, request }) => {
  // The administrator the first test made, signing in the way the deployment now offers.
  await page.goto(`${ORIGIN}/app`)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByLabel('Email address').fill('ada@example.com')
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click()
  await expect(page.getByRole('button', { name: /Ada Lovelace/ })).toBeVisible()

  // She invites a colleague as a Viewer — the role that reads and comments.
  await page.goto(`${ORIGIN}/app?view=boards`)
  await page.getByRole('button', { name: /^Admin/ }).click()
  const workspace = page.locator('section').filter({ has: page.getByRole('heading', { name: 'This workspace' }) })
  await workspace.getByPlaceholder('grace@example.com').fill('grace@example.com')
  // The role the invitation grants, chosen before the link is made: the select shows the description
  // with the name, so the match is on the label.
  await workspace.getByRole('combobox', { name: 'As' }).selectOption('viewer')
  await workspace.getByRole('button', { name: 'Make a link' }).click()
  const link = await workspace.getByLabel('Invitation link').inputValue()
  expect(link).toContain('invite=')

  // A browser that has never seen this instance opens it, and is asked for a name and a password
  // rather than sent to an identity provider it does not have.
  const other = await browser.newContext()
  try {
    const guest = await other.newPage()
    await guest.goto(link)
    await expect(guest.getByText('You have been invited to join as')).toBeVisible()
    await guest.getByLabel('Your name').fill('Grace Hopper')
    await guest.getByLabel('Password').fill(PASSWORD)
    await guest.getByRole('button', { name: 'Join' }).click()

    await expect(guest.getByRole('button', { name: /Grace Hopper/ })).toBeVisible()
    const session = await (await guest.request.get(`${ORIGIN}/api/auth/session`)).json()
    expect(session.workspaces[0].role).toBe('viewer')
  } finally {
    await other.close()
  }

  // The link is spent: opening it again says so rather than offering a second account.
  const spent = await request.get(`${ORIGIN}/api/invite/${new URL(link).searchParams.get('invite')}`)
  expect(spent.status()).toBe(410)
})

test('an administrator hands over a reset link, and it sets the password', async ({ page, browser, request }) => {
  // The same administrator, signing in with the password she chose.
  await page.goto(`${ORIGIN}/app`)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByLabel('Email address').fill('ada@example.com')
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click()
  await expect(page.getByRole('button', { name: /Ada Lovelace/ })).toBeVisible()

  await page.goto(`${ORIGIN}/app?view=boards`)
  await page.getByRole('button', { name: /^Admin/ }).click()
  const roster = page.locator('section').filter({ has: page.getByRole('heading', { name: 'This workspace' }) })
  const row = roster.locator('tr', { hasText: 'grace@example.com' })
  await row.getByRole('button', { name: 'Reset' }).click()
  const link = await roster.getByLabel('Invitation link').inputValue()
  expect(link).toContain('link=')

  // The person who forgot their password opens it and chooses a new one — no mail involved, which is
  // the point for a deployment with no relay.
  const other = await browser.newContext()
  try {
    const grace = await other.newPage()
    await grace.goto(link)
    await expect(grace.getByText('Choose the password this account will use')).toBeVisible()
    await grace.getByLabel('New password').fill('another good passphrase')
    await grace.getByRole('button', { name: 'Save the password' }).click()
    await expect(grace.getByRole('button', { name: /Grace Hopper/ })).toBeVisible()
  } finally {
    await other.close()
  }

  // The new password is the one that works, and the link is spent.
  const signedIn = await request.post(`${ORIGIN}/api/auth/password`, {
    data: { email: 'grace@example.com', password: 'another good passphrase' },
  })
  expect(signedIn.status()).toBe(200)
  const spent = await request.post(`${ORIGIN}/api/auth/link/${new URL(link).searchParams.get('link')}`)
  expect(spent.status()).toBe(410)
})
