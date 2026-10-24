import { expect, test, type Page } from '@playwright/test'

/**
 * Groups on screen: a role written once for several people, and a group that can be turned off
 * rather than deleted.
 *
 * Its own person, admitted through a domain the test instance is told to accept — the roster is
 * closed, and signing in as the account the other specs share would make this spec's edits their
 * problem.
 */

const SELF_HOSTED = 'http://localhost:4174'
const PERSON = 'groupie@example.com'

test.describe.configure({ mode: 'serial' })

async function signIn(page: Page, who: string) {
  await page.goto(`${SELF_HOSTED}/app`)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByPlaceholder('you@example.com').fill(who)
  await page.getByRole('button', { name: 'Sign in as this address' }).click()
}

test('a group carries a role, grants it to its people, and can be turned off', async ({ page, browser }) => {
  // The administrator, and a second person for the directory.
  await signIn(page, 'maya.blake@example.com')
  await expect(page.getByRole('button', { name: /Maya Blake/ })).toBeVisible()
  const domain = await page.request.patch(`${SELF_HOSTED}/api/admin/settings`, { data: { allowedDomains: ['example.com'] } })
  expect(domain.status()).toBe(200)

  const other = await browser.newContext()
  try {
    const person = await other.newPage()
    await signIn(person, PERSON)
    await expect(person.getByRole('button', { name: /Groupie/ })).toBeVisible()

    // The screen, through the workspace, as a person arrives at it.
    await page.goto(`${SELF_HOSTED}/app?view=boards`)
    await page.getByRole('button', { name: /^Admin/ }).click()
    await expect(page.getByRole('heading', { name: 'Groups' })).toBeVisible()

    // A group, named and explained.
    await page.getByPlaceholder('Platform Leads').fill('Platform Leads')
    await page.getByPlaceholder('optional').fill('The platform team')
    await page.getByRole('button', { name: 'Create group' }).click()
    await expect(page.getByText('was created')).toBeVisible()

    // It carries Editor here…
    await page.getByLabel('Role Platform Leads carries in this workspace').selectOption('editor')
    await expect(page.getByText('Now editor here.')).toBeVisible()

    // …and the person joins it.
    await page.getByRole('button', { name: 'person' }).click()
    await page.getByLabel('Add somebody to Platform Leads').selectOption({ label: 'Groupie' })
    await expect(page.getByText('Added.')).toBeVisible()
    const groups = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Groups' }) })
    await expect(groups.getByText('Groupie')).toBeVisible()

    // The people screen explains where the role came from rather than showing a bare word.
    const people = page.locator('section').filter({ has: page.getByRole('heading', { name: 'People' }) })
    await expect(people.getByText('via group')).toBeVisible()

    // Turned off: it grants nothing, and says so.
    await page.getByRole('button', { name: 'Turn off' }).click()
    await expect(page.getByText('Turned off — it grants nothing now.')).toBeVisible()
    await expect(groups.getByText('off', { exact: true })).toBeVisible()

    // The grant is gone from the server's point of view too — and with it the seat: the group was
    // this person's way into the workspace (task 162 — arrival is an account, not a seat).
    const session = await (await person.request.get(`${SELF_HOSTED}/api/auth/session`)).json()
    expect(session.workspaces).toEqual([])
  } finally {
    await other.close()
  }
})
