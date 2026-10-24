import { expect, test, type Page } from '@playwright/test'

/**
 * The workspace's own account, on an instance of its own.
 *
 * This spec **deletes the workspace**, so it runs against the instance on port 4176 rather than the
 * one the rest of the suite shares. It is the only place the whole arc is visible: a workspace
 * administrator sets who pays for it and what is billed, and then ends the workspace — and only that
 * workspace; the person keeps their account and is left with nothing to open.
 */

const ORIGIN = 'http://localhost:4176'

async function signIn(page: Page) {
  await page.goto(`${ORIGIN}/?board=b-atlas`)
  const account = page.getByRole('button', { name: /Owner/ })
  if (await account.isVisible().catch(() => false)) return
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByPlaceholder('you@example.com').fill('owner@example.com')
  await page.getByRole('button', { name: 'Sign in as this address' }).click()
  await expect(account).toBeVisible()
}

const openAdmin = async (page: Page) => {
  await page.goto(`${ORIGIN}/?view=boards`)
  await page.getByRole('button', { name: /^Admin/ }).click()
  await expect(page.getByRole('heading', { name: 'Workspace account' })).toBeVisible()
}

test.describe.configure({ mode: 'serial' })

test('the workspace has an owner and a bill, and both are the administrator’s to set', async ({ page }) => {
  await signIn(page)
  await openAdmin(page)

  const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Workspace account' }) })
  // The only member of this workspace is the person signed in, so the owner is herself.
  await panel.getByLabel(/Owner/).selectOption({ index: 1 })
  await panel.getByLabel('Billing email').fill('billing@atlas.example')
  await panel.getByLabel('Company').fill('Atlas Ltd')
  await panel.getByLabel('Plan').fill('Team')
  await panel.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Saved, and recorded in the audit.')).toBeVisible()

  // The record is the server's, not the form's: a reload shows what was stored.
  await page.reload()
  await openAdmin(page)
  const again = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Workspace account' }) })
  await expect(again.getByLabel('Billing email')).toHaveValue('billing@atlas.example')
  await expect(again.getByLabel('Company')).toHaveValue('Atlas Ltd')

  // No card number, and the panel says so rather than hiding the limit.
  await expect(page.getByText(/Card numbers are never stored here/)).toBeVisible()
})

test('deleting the workspace asks for its name, and leaves the person with nothing to open', async ({ page }) => {
  await signIn(page)
  await openAdmin(page)

  await page.getByRole('button', { name: 'Delete this workspace…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete this workspace' })

  // The name is required, and the server checks it too.
  await dialog.getByLabel('Type the workspace name to confirm').fill('not the name')
  await expect(dialog.getByRole('button', { name: 'Delete this workspace' })).toBeDisabled()
  await dialog.getByLabel('Type the workspace name to confirm').fill('Flowline')
  await dialog.getByRole('button', { name: 'Delete this workspace' }).click()

  // The app has no workspace left to draw the account's work from, and says so.
  await expect(page.getByText('No workspace')).toBeVisible()
  await expect.poll(async () => (await page.request.get(`${ORIGIN}/api/workspace`)).status()).toBe(404)

  // The person's account survives — they are signed in, with nothing to open.
  const session = await (await page.request.get(`${ORIGIN}/api/auth/session`)).json()
  expect(session.user.email).toBe('owner@example.com')
  expect(session.workspaces).toEqual([])
  // And it took only that workspace: the account itself, its people and the instance remain.
  expect((await page.request.get(`${ORIGIN}/api/auth/providers`)).ok()).toBeTruthy()
})
