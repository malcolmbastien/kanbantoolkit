import { expect, test, type Page } from '@playwright/test'

/**
 * The workspace's own account, on an instance of its own.
 *
 * This spec **deletes the workspace**, so it runs against the instance on port 4176 rather than the
 * one the rest of the suite shares. It is the only place the whole arc is visible: the workspace
 * comes with the installation and is named by it, a signed-in person who is not in it is told so
 * rather than handed a form, and ending it takes its accounts with it.
 */

const ORIGIN = 'http://localhost:4176'

async function signIn(page: Page) {
  await page.goto(`${ORIGIN}/app?board=b-atlas`)
  const account = page.getByRole('button', { name: /Owner/ })
  if (await account.isVisible().catch(() => false)) return
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByPlaceholder('you@example.com').fill('owner@example.com')
  await page.getByRole('button', { name: 'Sign in as this address' }).click()
  await expect(account).toBeVisible()
}

const openAdmin = async (page: Page) => {
  await page.goto(`${ORIGIN}/app?view=boards`)
  await page.getByRole('button', { name: /^Admin/ }).click()
  await expect(page.getByRole('heading', { name: 'This workspace' })).toBeVisible()
}

test.describe.configure({ mode: 'serial' })

test('the workspace has a name and an end, and no bill at all', async ({ page }) => {
  await signIn(page)
  await openAdmin(page)

  const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'This workspace' }) })

  // The name is the administrator's to set, and the server is what remembers it.
  await panel.getByLabel('Name').fill('Atlas Delivery')
  await panel.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(panel.getByText('Saved.')).toBeVisible()
  await page.reload()
  await openAdmin(page)
  await expect(page.locator('section').filter({ has: page.getByRole('heading', { name: 'This workspace' }) }).getByLabel('Name')).toHaveValue('Atlas Delivery')

  // Nothing is sold, so there is nothing to bill: no owner, no address, no plan (task 166).
  for (const gone of ['Owner', 'Billing email', 'Company', 'Plan', 'Billing reference']) {
    await expect(panel.getByLabel(gone, { exact: false })).toHaveCount(0)
  }
  await expect(page.getByText(/Card numbers are never stored here/)).toHaveCount(0)
  // And the route that carried the record is gone with it.
  expect((await page.request.get(`${ORIGIN}/api/workspace/account`)).status()).toBe(404)

  // The end of the workspace is here, behind a typed confirmation.
  await expect(panel.getByRole('button', { name: 'Delete this workspace…' })).toBeVisible()
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

  // The name a person types is the workspace's, and the server checks it. (The previous test
  // renamed this one, which is the other half of the same promise: the name is the team's to keep.)
  const read = (await (await page.request.get(`${ORIGIN}/api/admin/workspace`)).json()) as {
    workspace: { name: string }
  }
  const name = read.workspace.name
  expect(name.length).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Delete this workspace…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete this workspace' })

  // The name is required, and the server checks it too.
  await dialog.getByLabel('Type the workspace name to confirm').fill('not the name')
  await expect(dialog.getByRole('button', { name: 'Delete this workspace' })).toBeDisabled()
  await dialog.getByLabel('Type the workspace name to confirm').fill(name)
  // The act itself is made with the same route the button calls, so the assertion carries the
  // server's own answer if it refuses. (The button and its disabled state are checked above.)
  const answer = await page.request.delete(`${ORIGIN}/api/workspace`, { data: { confirm: name } })
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

test('a deleted workspace comes back for an administrator, and no second can be made', async ({ page, playwright }) => {
  // The previous test deleted the workspace *and its accounts*, and left one operator administering
  // the deployment. That is the interesting state (task 163): the workspace comes with the
  // installation, so it comes back the same way — not from a form, and not for just anybody.
  const api = await playwright.request.newContext({ baseURL: ORIGIN })
  try {
    // A stranger signing in is an account, not a seat: they are told where they stand, and given
    // nothing to press. There is no sign-up that would make them a team.
    await page.goto(`${ORIGIN}/app?board=b-atlas`)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByPlaceholder('you@example.com').fill('founder@example.com')
    await page.getByRole('button', { name: 'Sign in as this address' }).click()
    await expect(page.getByText('Not in this workspace')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create a workspace' })).toHaveCount(0)

    const refused = await page.request.post(`${ORIGIN}/api/workspaces`, { data: { name: 'Northwind' } })
    expect(refused.status()).toBe(409)
    expect(((await refused.json()) as { error: string }).error).toContain('one workspace')
    expect((await page.request.get(`${ORIGIN}/api/workspace`)).status()).toBe(404)

    // The operator who was left administering the deployment re-opens it by arriving. The name is
    // the installation's (`WORKSPACE_NAME`, set for this instance in `playwright.config.ts`), and
    // they are its administrator — there is no second workspace and nobody chose this one.
    expect((await api.post('/api/auth/dev', { data: { email: 'operator@example.com' } })).ok()).toBeTruthy()
    const reopened = await api.get('/api/workspace')
    expect(reopened.status()).toBe(200)
    const panel = (await (await api.get('/api/admin/workspace')).json()) as { workspace: { name: string } }
    expect(panel.workspace.name).toBe('Team Atlas')

    const session = (await (await api.get('/api/auth/session')).json()) as {
      workspaces: Array<{ role: string }>
    }
    expect(session.workspaces).toHaveLength(1)
    expect(session.workspaces[0].role).toBe('admin')
  } finally {
    await api.dispose()
  }
})
