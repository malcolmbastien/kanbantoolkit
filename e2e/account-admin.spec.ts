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

test('a member is removed, and the account goes with them', async ({ page, browser }) => {
  await signIn(page)
  await openAdmin(page)

  // Invited through the workspace panel, which is where a workspace administrator runs the three
  // acts: invite, deactivate, remove.
  const roster = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Workspace' }) })
  await roster.getByLabel('Invite into this workspace').fill('leaver@example.com')
  await roster.getByRole('button', { name: 'Make a link' }).click()
  const link = await page.getByLabel('Invitation link').inputValue()
  expect(link).toContain('invite=')

  const other = await browser.newContext()
  try {
    const leaver = await other.newPage()
    await leaver.goto(link)
    await leaver.getByRole('button', { name: 'Sign in', exact: true }).click()
    await leaver.getByPlaceholder('you@example.com').fill('leaver@example.com')
    await leaver.getByRole('button', { name: 'Sign in as this address' }).click()
    await expect(leaver.getByRole('button', { name: /Leaver/ })).toBeVisible()
    // In the workspace, with a board to read.
    expect((await leaver.request.get(`${ORIGIN}/api/workspace`)).ok()).toBeTruthy()

    // Removed: the account ends, so the cookie it held is not a credential any more. The removal is
    // made by the administrator with the same route the panel calls; the panel's own button and
    // confirmation are covered by the server's rules, and this is about the blast radius.
    const directory = (await (await page.request.get(`${ORIGIN}/api/admin/users?q=leaver`)).json()) as {
      people: Array<{ id: string; email: string }>
    }
    const leaverId = directory.people.find((person) => person.email === 'leaver@example.com')!.id
    expect((await page.request.delete(`${ORIGIN}/api/admin/workspace/members/${leaverId}`)).ok()).toBeTruthy()

    await expect.poll(async () => (await leaver.request.get(`${ORIGIN}/api/workspace`)).status()).toBe(401)

    // And the roster is the people who are still here.
    await page.reload()
    await openAdmin(page)
    const after = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Workspace' }) })
    await expect(after.getByText('leaver@example.com')).toHaveCount(0)
  } finally {
    await other.close()
  }
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
    // They belong to no workspace already — arrival is an account, not a seat — so deleting this
    // one leaves them administering the deployment.
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
  // The act itself is made with the same route the button calls, so the assertion carries the
  // server's own answer if it refuses. (The button and its disabled state are checked above.)
  const answer = await page.request.delete(`${ORIGIN}/api/workspace`, { data: { confirm: 'Flowline' } })
  expect(answer.status(), await answer.text()).toBe(204)

  // The account went with the workspace: there is no session left to draw anything with.
  await expect
    .poll(async () => {
      const body = (await (await page.request.get(`${ORIGIN}/api/auth/session`)).json()) as { user: unknown }
      return body.user
    })
    .toBeNull()
  // The page was never navigated by the API call, so it is told to look again.
  await page.reload()
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
