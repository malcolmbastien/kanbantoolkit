import { expect, test, type Page } from '@playwright/test'

/**
 * Where you are signed in, and how you leave.
 *
 * Against the self-hosted entry, because a session is the server's promise: the cookie, the row and
 * the list are one thing, and a browser test is the only place they can be seen together.
 *
 * These tests sign in as their own person, admitted through a domain the instance is told to
 * accept. Signing in as the account the other specs share would make "sign out everywhere" a way of
 * failing somebody else's test.
 */

const SELF_HOSTED = 'http://localhost:4174'
const PERSON = 'session-tester@example.com'

test.describe.configure({ mode: 'serial' })

async function signIn(page: Page, who = PERSON, remember = false) {
  await page.goto(`${SELF_HOSTED}/app`)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  if (remember) await page.getByLabel(/Keep me signed in/).check()
  await page.getByPlaceholder('you@example.com').fill(who)
  await page.getByRole('button', { name: 'Sign in as this address' }).click()
  await expect(page.getByRole('button', { name: /Session/ })).toBeVisible()
}

const openProfile = async (page: Page) => {
  await page.getByRole('button', { name: /Session/ }).click()
  await page.getByRole('button', { name: 'Profile' }).click()
  return page.getByRole('dialog', { name: 'Your profile' })
}

test.beforeAll(async ({ browser }) => {
  // The instance is closed by default, so a second identity needs a door. One is opened here, by
  // the first account, and only for `example.com` on the test instance.
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${SELF_HOSTED}/app`)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByPlaceholder('you@example.com').fill('maya.blake@example.com')
  await page.getByRole('button', { name: 'Sign in as this address' }).click()
  await expect(page.getByRole('button', { name: /Maya Blake/ })).toBeVisible()

  const changed = await page.request.patch(`${SELF_HOSTED}/api/admin/settings`, {
    data: { allowedDomains: ['example.com'] },
  })
  expect(changed.status()).toBe(200)
  await context.close()
})

test('a person sees where they are signed in, marked for this device', async ({ page }) => {
  await signIn(page)
  const dialog = await openProfile(page)

  await expect(dialog.getByText('Where you’re signed in')).toBeVisible()
  await expect(dialog.getByText('this device')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Sign out everywhere' })).toBeVisible()
})

test('ending one session leaves the other working', async ({ page, browser }) => {
  await signIn(page)

  // A second device: its own browser, its own cookie, the same person.
  const other = await browser.newContext()
  try {
    const second = await other.newPage()
    await signIn(second)

    const dialog = await openProfile(page)
    // The list can tell which session is this one, and there is more than one device on it.
    await expect(dialog.getByText('this device')).toHaveCount(1)

    // The session the *other* browser is holding, named by that browser: revoking anything else
    // would prove nothing about a second device.
    const theirs = ((await (await second.request.get(`${SELF_HOSTED}/api/me/sessions`)).json()) as {
      sessions: Array<{ id: string; current: boolean }>
    }).sessions.find((session) => session.current)!

    const ended = await page.request.delete(`${SELF_HOSTED}/api/me/sessions/${theirs.id}`)
    expect(ended.ok()).toBeTruthy()

    // The other browser is signed out; this one is still here.
    expect((await second.request.get(`${SELF_HOSTED}/api/me`)).status()).toBe(401)
    expect((await page.request.get(`${SELF_HOSTED}/api/me`)).ok()).toBeTruthy()
  } finally {
    await other.close()
  }
})

test('the remembered choice is thirty days, the default is twelve hours', async ({ page }) => {
  await signIn(page)
  const ordinary = (await (await page.request.get(`${SELF_HOSTED}/api/me/sessions`)).json()) as {
    sessions: Array<{ expiresAt: string; current: boolean }>
  }
  const hours = (Date.parse(ordinary.sessions.find((session) => session.current)!.expiresAt) - Date.now()) / 3_600_000
  expect(hours).toBeGreaterThan(11)
  expect(hours).toBeLessThan(13)

  await page.getByRole('button', { name: /Session/ }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await signIn(page, PERSON, true)

  const remembered = (await (await page.request.get(`${SELF_HOSTED}/api/me/sessions`)).json()) as {
    sessions: Array<{ expiresAt: string; current: boolean }>
  }
  const days = (Date.parse(remembered.sessions.find((session) => session.current)!.expiresAt) - Date.now()) / 86_400_000
  expect(days).toBeGreaterThan(29)
  expect(days).toBeLessThan(31)
})

test('signing out everywhere ends this browser too', async ({ page }) => {
  await signIn(page)
  const dialog = await openProfile(page)
  await dialog.getByRole('button', { name: 'Sign out everywhere' }).click()

  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  // The cookie it was holding is not a credential any more.
  expect((await page.request.get(`${SELF_HOSTED}/api/me`)).status()).toBe(401)
})
