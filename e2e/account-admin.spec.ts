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

test('deleting the workspace asks for its name, and takes its accounts with it', async ({ page, playwright }) => {
  await signIn(page)

  // Somebody has to be outside the workspace before its accounts can go: deleting it would otherwise
  // remove the deployment's last administrator, which the server refuses. An operator — administers
  // the deployment, belongs to no workspace — is appointed here, through the same routes a screen
  // would call. A request context of its own, so signing the operator in does not take the cookie
  // away from the page that is about to delete the workspace.
  const api = await playwright.request.newContext({ baseURL: ORIGIN })
  try {
    // The operator has to exist before anybody can appoint them: signing in is what creates the
    // account, and it happens in a jar of its own so the page keeps the owner's cookie. The roster
    // is closed by default, so the domain these tests use is opened first.
    expect((await page.request.patch(`${ORIGIN}/api/admin/settings`, { data: { allowedDomains: ['example.com'] } })).ok()).toBeTruthy()
    expect((await api.post('/api/auth/dev', { data: { email: 'operator@example.com' } })).ok()).toBeTruthy()
    const directory = (await (await page.request.get(`${ORIGIN}/api/admin/users?q=operator`)).json()) as {
      people: Array<{ id: string; email: string }>
    }
    const operator = directory.people.find((person) => person.email === 'operator@example.com')!
    expect((await page.request.patch(`${ORIGIN}/api/admin/users/${operator.id}/instance`, { data: { role: 'admin' } })).ok()).toBeTruthy()
    // …and belongs to no workspace, so deleting this one leaves them administering the deployment.
    expect((await page.request.delete(`${ORIGIN}/api/admin/workspace/members/${operator.id}`)).ok()).toBeTruthy()
  } finally {
    await api.dispose()
  }

  await openAdmin(page)

  await page.getByRole('button', { name: 'Delete this workspace…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete this workspace' })

  // The name is required, and the server checks it too.
  await dialog.getByLabel('Type the workspace name to confirm').fill('not the name')
  await expect(dialog.getByRole('button', { name: 'Delete this workspace' })).toBeDisabled()
  await dialog.getByLabel('Type the workspace name to confirm').fill('Flowline')
  await dialog.getByRole('button', { name: 'Delete this workspace' }).click()

  // The account went with the workspace: there is no session left to draw anything with.
  await expect
    .poll(async () => {
      const body = (await (await page.request.get(`${ORIGIN}/api/auth/session`)).json()) as { user: unknown }
      return body.user
    })
    .toBeNull()
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  // The deployment is still there, and so is the operator appointed before the deletion.
  expect((await page.request.get(`${ORIGIN}/api/auth/providers`)).ok()).toBeTruthy()
})

test('a new account creates the workspace it owns', async ({ page }) => {
  // The previous test deleted the workspace *and its accounts*, so this is somebody new signing up.
  // (The addressed account is created by signing in; the workspace is created as part of the same
  // act, which is what a sign-up page will present as one step.)
  const signUp = async () => {
    await page.goto(`${ORIGIN}/?board=b-atlas`)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByPlaceholder('you@example.com').fill('founder@example.com')
    await page.getByRole('button', { name: 'Sign in as this address' }).click()
    await expect(page.getByRole('button', { name: /Founder/ })).toBeVisible()
  }
  await signUp()
  await expect(page.getByText('No workspace')).toBeVisible()

  await page.getByRole('button', { name: 'Create a workspace' }).click()
  const dialog = page.getByRole('dialog', { name: 'Create a workspace' })
  // The owner is the account itself, shown and not typed.
  await expect(dialog.getByText('founder@example.com')).toBeVisible()
  await dialog.getByLabel('Workspace name').fill('Northwind')
  await dialog.getByRole('button', { name: 'Create workspace' }).click()

  // The board opens on the new one, and the account is its administrator and its owner.
  await expect.poll(async () => (await page.request.get(`${ORIGIN}/api/workspace`)).status()).toBe(200)
  await expect(page.getByText('No workspace')).toHaveCount(0)
  const session = await (await page.request.get(`${ORIGIN}/api/auth/session`)).json()
  expect(session.workspaces[0].role).toBe('admin')
  const account = await (await page.request.get(`${ORIGIN}/api/workspace/account`)).json()
  expect(account).toMatchObject({ name: 'Northwind', ownerName: 'Founder' })
})
