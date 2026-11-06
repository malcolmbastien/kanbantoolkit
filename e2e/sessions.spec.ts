import { randomBytes } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import sharp from 'sharp'

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

const SELF_HOSTED = 'http://localhost:4183'
const PERSON = 'session-tester@example.com'

test.describe.configure({ mode: 'serial' })

/** The instance's front door: the sign-in screen is the page, so there is no menu to open. */
async function signIn(page: Page, who = PERSON, remember = false) {
  await page.goto(`${SELF_HOSTED}/app`)
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

  // Signing out everywhere ends the session here too, so the page falls back to the instance's front
  // door.
  await expect(page.getByText('Sign in to this instance')).toBeVisible()
  await expect(page.getByPlaceholder('you@example.com')).toBeVisible()
  // The cookie it was holding is not a credential any more.
  expect((await page.request.get(`${SELF_HOSTED}/api/me`)).status()).toBe(401)
})

test('a large picture is resized, stored and reaches the workspace directory', async ({ page }) => {
  // The first account: it is the one that belongs to the workspace, and the picture test changes
  // only its face, not the name the session tests read.
  await page.goto(`${SELF_HOSTED}/app`)
  await page.getByPlaceholder('you@example.com').fill('maya.blake@example.com')
  await page.getByRole('button', { name: 'Sign in as this address' }).click()
  await expect(page.getByRole('button', { name: /Maya Blake/ })).toBeVisible()

  await page.getByRole('button', { name: /Maya Blake/ }).click()
  await page.getByRole('button', { name: 'Profile' }).click()
  const dialog = page.getByRole('dialog', { name: 'Your profile' })
  await expect(dialog.getByText('Picture')).toBeVisible()

  // A noisy 1200px PNG: well over the old 256 KB upload limit, and over the stored limit too.
  const png = await sharp(randomBytes(1200 * 1200 * 3), {
    raw: { width: 1200, height: 1200, channels: 3 },
  })
    .png()
    .toBuffer()
  expect(png.length).toBeGreaterThan(256 * 1024)
  await dialog.locator('input[type=file]').setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: png })
  await expect(dialog.locator('img')).toBeVisible()
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toHaveCount(0)

  // The account menu now wears the same face — the session payload carries it, not just `/api/me`.
  await expect(page.getByRole('button', { name: /Maya Blake/ }).locator('img')).toBeVisible()

  // What the account stored is the resized image, not the original.
  const profile = (await (await page.request.get(`${SELF_HOSTED}/api/me`)).json()) as { avatarUrl?: string }
  expect(profile.avatarUrl).toMatch(/^data:image\/(webp|png);base64,/)
  const bytes = Math.floor(((profile.avatarUrl!.split(',')[1] ?? '').length * 3) / 4)
  expect(bytes).toBeLessThanOrEqual(256 * 1024)

  // The session carries it, and so does the workspace roster that assignees and the picker read.
  const session = (await (await page.request.get(`${SELF_HOSTED}/api/auth/session`)).json()) as {
    user: { id: string; avatarUrl?: string }
  }
  expect(session.user.avatarUrl).toBe(profile.avatarUrl)
  const workspaceResponse = await page.request.get(`${SELF_HOSTED}/api/workspace`)
  expect(workspaceResponse.status()).toBe(200)
  const workspace = (await workspaceResponse.json()) as { users: Array<{ id: string; avatarUrl?: string }> }
  expect(workspace.users.find((user) => user.id === session.user.id)?.avatarUrl).toBe(profile.avatarUrl)
})
