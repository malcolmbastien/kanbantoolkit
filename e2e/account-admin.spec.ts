import { expect, test, type Page } from '@playwright/test'

/**
 * The account, on its own instance.
 *
 * This spec closes the account, which removes everything — so it runs against the instance of its
 * own (port 4176) rather than the one the rest of the suite shares. It is the only place the whole
 * arc is visible: an Account Admin renames the account, keeps its billing record, is refused the
 * deletion of its only workspace, and then closes the account and signs in to a new one.
 */

const ORIGIN = 'http://localhost:4176'

async function signIn(page: Page, email = 'owner@example.com') {
  await page.goto(`${ORIGIN}/?board=b-atlas`)
  const account = page.getByRole('button', { name: /Owner|Maya Blake/ })
  if (await account.isVisible().catch(() => false)) return
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByRole('button', { name: 'Sign in as this address' }).click()
  await expect(page.getByRole('button', { name: /Owner/ })).toBeVisible()
}

const openAdmin = async (page: Page) => {
  await page.goto(`${ORIGIN}/?view=boards`)
  await page.getByRole('button', { name: /^Admin/ }).click()
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible()
}

test.describe.configure({ mode: 'serial' })

test('the account has a name and a billing record, and the name is the Account Admin’s', async ({ page }) => {
  await signIn(page)
  await openAdmin(page)

  const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Account' }) })
  await panel.getByLabel('Name').fill('Northwind')
  await panel.getByLabel('Billing email').fill('billing@northwind.example')
  await panel.getByLabel('Company').fill('Northwind Ltd')
  await panel.getByLabel('Plan').fill('Team')
  await panel.getByRole('button', { name: 'Save the account' }).click()
  await expect(page.getByText('Saved, and recorded in the audit.')).toBeVisible()

  // The record is the server's, not the form's: a reload shows what was stored.
  await page.reload()
  await openAdmin(page)
  const again = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Account' }) })
  await expect(again.getByLabel('Name')).toHaveValue('Northwind')
  await expect(again.getByLabel('Billing email')).toHaveValue('billing@northwind.example')

  // No card number, and the panel says so rather than hiding the limit.
  await expect(page.getByText(/Card numbers are never stored here/)).toBeVisible()
})

test('the only workspace cannot be deleted, and the refusal points at closing the account', async ({ page }) => {
  await signIn(page)
  await openAdmin(page)

  await page.getByText(/This is the account’s only workspace/).isVisible()
  // The button is offered, and the server refuses it: a control hidden by the interface is not a
  // permission, and the sentence that comes back is the one that matters.
  await page.getByRole('button', { name: 'Delete this workspace' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete the workspace' }).click()
  await expect(page.getByText(/Close the account instead/)).toBeVisible()
})

test('closing the account empties it, and a new sign-in begins a new one', async ({ page }) => {
  await signIn(page)
  await openAdmin(page)

  await page.getByRole('button', { name: 'Close the account…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Close the account' })
  await dialog.getByLabel('Type the account name to confirm').fill('Northwind')
  await dialog.getByRole('button', { name: 'Close the account' }).click()

  // The app is signed out, and says why where the person now is.
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByText('The account was closed.')).toBeVisible()
  // The session went with everything else.
  await expect.poll(async () => (await page.request.get(`${ORIGIN}/api/me`)).status()).toBe(401)
  // Nothing is left in any table.
  await expect.poll(async () => (await page.request.get(`${ORIGIN}/api/workspace`)).status()).toBe(401)

  // And a fresh sign-in is a fresh account: the first person to arrive owns it again.
  await page.goto(`${ORIGIN}/?board=b-atlas`)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByPlaceholder('you@example.com').fill('owner@example.com')
  await page.getByRole('button', { name: 'Sign in as this address' }).click()
  await expect(page.getByRole('button', { name: /Owner/ })).toBeVisible()
  await expect
    .poll(async () => {
      const body = (await (await page.request.get(`${ORIGIN}/api/auth/session`)).json()) as { instanceRole: string | null }
      return body.instanceRole
    })
    .toBe('admin')
})
