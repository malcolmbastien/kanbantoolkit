import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { addCardTo, openInstanceBoard, signInOnInstance } from './support'

// These tests share one instance and its database, and each builds on what the one before made:
// one account, one board, the cards on it. Run them in order so a rename in one is never a surprise
// in another.
test.describe.configure({ mode: 'serial' })
// Every test here signs in over the network, adopts a workspace and (most of them) waits for a write
// to land on the instance: the default thirty seconds is a page that has not started yet, not this.
test.setTimeout(120_000)

/**
 * An instance, from a browser's side.
 *
 * A deployment with a server is not a demo: it shows its door before it shows a board, and the
 * workspace a person sees after signing in is the account's — which on a fresh instance is empty.
 * The development switch stands in for a provider on purpose: it is the one identity that needs no
 * outside service, and the flow after it — session cookie, reload, sign-out — is the same flow a
 * real provider's callback ends in.
 */
const SELF_HOSTED = 'http://localhost:4174'
const MAYA = { email: 'maya.blake@example.com', name: 'Maya Blake' }
const BOARD = 'Team Atlas'

/** The board this file builds, open, with a card to read. */
async function boardOpen(page: Page): Promise<void> {
  await openInstanceBoard(page, SELF_HOSTED, BOARD, MAYA)
}

/** A card on the board, found by its own title, opened in the panel. */
async function openCardTitled(page: Page, title: string): Promise<void> {
  await page.locator('[data-workflow="cards"] [data-card-id]').filter({ hasText: title }).first().click()
  await expect(page.getByLabel('Title')).toBeVisible()
}

test('the front door is the instance’s, and a session survives a reload', async ({ page }) => {
  await page.goto(`${SELF_HOSTED}/app`)

  // Nothing is drawn behind the door: a fresh instance belongs to nobody yet, and the demo is the
  // static tier's welcome, not this deployment's data.
  await expect(page.getByText('Sign in to this instance')).toBeVisible()
  await expect(page.locator('[data-workflow]')).toHaveCount(0)

  await page.getByPlaceholder('you@example.com').fill(MAYA.email)
  await page.getByRole('button', { name: 'Sign in as this address' }).click()

  // The account becomes the workspace's own person of that name, so "my work" and the author on a
  // change are right.
  await expect(page.getByRole('button', { name: /Maya Blake/ })).toBeVisible()
  // Signing in lands on the workspace home — every board — rather than a board's own flow.
  await expect(page.getByRole('heading', { name: 'Workspace Home' })).toBeVisible()

  // A reload asks the cookie rather than the person.
  await page.reload()
  await expect(page.getByRole('button', { name: /Maya Blake/ })).toBeVisible()

  // Signing out closes the door behind you.
  await page.getByRole('button', { name: /Maya Blake/ }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByText('Sign in to this instance')).toBeVisible()
})

test('an empty workspace makes its first board, and the board outlives the browser', async ({ page }) => {
  await signInOnInstance(page, SELF_HOSTED, MAYA)
  await page.goto(`${SELF_HOSTED}/app?view=boards`)

  // The empty state is the workspace telling the truth: nothing was seeded for the administrator.
  await expect(page.getByText('This workspace is empty')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Invite people' })).toBeVisible()

  await page.getByRole('button', { name: 'New board' }).first().click()
  await page.getByLabel('New board name').fill(BOARD)
  await page.getByRole('button', { name: 'Create board' }).click()
  await page.getByRole('button', { name: BOARD, exact: true }).click()
  await expect(page.locator('[data-workflow="cards"]')).toBeVisible()

  // A card, so the board has something in it — a lane's own footer is the one way in for new work.
  await addCardTo(page, 'Backlog')

  // The design is on the server, not only in this browser: a reload asks the instance and gets the
  // board back (this is the write that used to have no path at all).
  const workspace = async () => {
    const response = await page.request.get(`${SELF_HOSTED}/api/workspace`)
    return (await response.json()) as { boards: Array<{ name: string }>; lanes: unknown[] }
  }
  await expect.poll(async () => (await workspace()).boards.map((board) => board.name)).toContain(BOARD)
  // The card and the place it sits travel their own way; wait for the instance to have both before
  // asking a fresh page for them.
  await expect
    .poll(async () => {
      const body = (await (await page.request.get(`${SELF_HOSTED}/api/workspace`)).json()) as {
        items: unknown[]
        placements: unknown[]
      }
      return body.items.length > 0 && body.placements.length > 0
    })
    .toBe(true)

  await page.reload()
  await expect(page.locator('[data-workflow="cards"]')).toBeVisible({ timeout: 20_000 })
  // The page draws what this browser held first and the account's workspace a moment later; the
  // card is there once the instance's answer has been adopted.
  await expect(page.locator('[data-workflow="cards"] [data-card-id]')).toHaveCount(1, { timeout: 20_000 })

  // My work is hers and says so, with no way to become somebody else. It lives under the account
  // menu now, because it is about the person rather than the board.
  await page.getByRole('button', { name: /Maya Blake/ }).click()
  await page.getByRole('button', { name: 'My work' }).click()
  await expect(page.getByText(/Signed in as/)).toBeVisible()
  await expect(page.getByLabel('Whose work to show')).toHaveCount(0)
})

test('a card says who made it, in the panel and in the workspace’s own record', async ({ page }) => {
  await boardOpen(page)
  await addCardTo(page, 'Backlog')
  await openCardTitled(page, 'New card')

  const panel = page.locator('[data-item-panel]')
  await expect(panel).toContainText('Created by')
  await expect(panel).toContainText('Maya Blake')
  const recorded = await panel.locator('[data-created-by]').getAttribute('data-created-by')

  // The record is her id, not her name — what an agent or another client reads. (The API's own
  // answer is asserted in server/v1.test.ts, where the caller is the creator by the server's hand.)
  const body = (await (await page.request.get(`${SELF_HOSTED}/api/workspace`)).json()) as {
    users: Array<{ id: string; name: string }>
    items: Array<{ title: string; createdById?: string }>
  }
  const maya = body.users.find((person) => person.name === 'Maya Blake')!
  expect(recorded).toBe(maya.id)
  expect(body.items.some((item) => item.createdById === maya.id)).toBe(true)
})

test('an edit made while signed in reaches the server', async ({ page }) => {
  await boardOpen(page)
  const card = page.locator('[data-workflow="cards"] [data-card-id]').first()
  await card.click()
  await page.getByLabel('Title').fill('This reached the server')

  // Read it back with the browser's own session, from the instance rather than the page.
  await expect
    .poll(async () => {
      const answer = await page.request.get(`${SELF_HOSTED}/api/workspace`)
      const body = (await answer.json()) as { items: Array<{ title: string }> }
      return body.items.some((item) => item.title === 'This reached the server')
    })
    .toBe(true)
})

test('an edit made offline waits, and lands when the connection comes back', async ({ page, context }) => {
  await boardOpen(page)
  // A card of this test's own: an earlier card's lease would still be live for up to a minute, and
  // the drawer shuts its fields while somebody else holds the pen.
  await addCardTo(page, 'Backlog')
  await page.locator('[data-workflow="cards"] [data-card-id]').filter({ hasText: 'New card' }).last().click()
  await expect(page.getByLabel('Title')).toBeVisible()

  await context.setOffline(true)
  await page.getByLabel('Title').fill('Written on a train')

  // Held rather than lost, and the toolbar says how much is held. Found by its own explanation,
  // because "1 waiting" is also a card's own badge for what it waits on.
  const held = page.getByTitle(/could not be reached/)
  await expect(held).toContainText('waiting')

  await context.setOffline(false)

  // The queue moves by itself: no reload, no retry button.
  await expect
    .poll(async () => {
      const answer = await page.request.get(`${SELF_HOSTED}/api/workspace`)
      const body = (await answer.json()) as { items: Array<{ title: string }> }
      return body.items.some((item) => item.title === 'Written on a train')
    }, { timeout: 20_000 })
    .toBe(true)

  await expect(page.getByTitle(/could not be reached/)).toHaveCount(0)
})

test('a change made on one device arrives on another without a reload', async ({ browser }) => {
  const one = await browser.newContext()
  const two = await browser.newContext()

  try {
    const away = await one.newPage()
    // The first device stands on the board (making it if this is a fresh instance) and puts a card
    // on it; the design and the card have to reach the server before the second device can adopt
    // the same workspace.
    await boardOpen(away)
    await addCardTo(away, 'Backlog')
    await expect
      .poll(async () => {
        const body = (await (await away.request.get(`${SELF_HOSTED}/api/workspace`)).json()) as {
          items: unknown[]
          placements: unknown[]
        }
        return body.items.length > 0 && body.placements.length > 0
      })
      .toBe(true)

    const here = await two.newPage()
    await openInstanceBoard(here, SELF_HOSTED, BOARD, MAYA)

    const card = away.locator('[data-workflow="cards"] [data-card-id]').filter({ hasText: 'New card' }).last()
    const id = await card.getAttribute('data-card-id')
    await card.click()
    await away.getByLabel('Title').fill('Changed on the other device')
    await away.keyboard.press('Escape')

    // The reader is never navigated: the channel says the card moved, and the board redraws.
    await expect(here.locator(`[data-card-id="${id}"]`)).toContainText('Changed on the other device', { timeout: 20_000 })
  } finally {
    await one.close()
    await two.close()
  }
})

test('a card being edited is held, and the pen is refused to anybody else', async ({ page }) => {
  await boardOpen(page)
  // A card of this test's own, so the test does not depend on what earlier tests left behind.
  await addCardTo(page, 'Backlog')

  const card = page.locator('[data-workflow="cards"] [data-card-id]').filter({ hasText: 'New card' }).last()
  const id = await card.getAttribute('data-card-id')
  await card.click()

  // Edit intent, not opening: putting the caret in the title is what takes the pen.
  await page.getByLabel('Title').click()

  // The feed every other client reads says who holds it — the same feed the drawer reads.
  const locks = async () => {
    const feed = (await (await page.request.get(`${SELF_HOSTED}/api/workspace/changes?since=0`)).json()) as {
      locks: Array<{ itemId: string; holderName: string }>
    }
    return feed.locks
  }
  await expect
    .poll(async () => (await locks()).some((lock) => lock.itemId === id && lock.holderName === 'Maya Blake'))
    .toBe(true)

  // And the pen is refused to anybody else: a write from another tab is told, not applied.
  const refused = await page.request.patch(`${SELF_HOSTED}/api/workspace/items/${id}`, {
    headers: { 'content-type': 'application/json', 'x-kanbantoolkit-tab': 'another-tab' },
    data: { baseRev: 0, item: { id, title: 'Mine', typeId: 't-story', createdAt: 1 } },
  })
  expect(refused.status()).toBe(423)
})

test('an administrator sees the people, and cannot close their own door', async ({ page }) => {
  await signInOnInstance(page, SELF_HOSTED, MAYA)

  // Through the workspace, which is the only way in — and the way a person actually arrives.
  await page.goto(`${SELF_HOSTED}/app?view=boards`)
  await page.getByRole('button', { name: /^Admin/ }).click()

  // The sections are tabs. People is the one list where the workspace's members and the instance's
  // people meet: a role is changed there, not in a second table beside it.
  await expect(page.getByRole('tab', { name: 'People' })).toBeVisible()
  await page.getByRole('tab', { name: 'People' }).click()
  await expect(page.getByRole('heading', { name: 'People' })).toBeVisible()

  const people = page.locator('section').filter({ has: page.getByRole('heading', { name: 'People' }) })
  await expect(people.getByRole('table')).toContainText('maya.blake@example.com')

  // The drawer explains the guard before the server has to refuse it.
  await people.getByRole('button', { name: 'Open Maya Blake' }).click()
  await expect(page.getByText('You cannot deactivate yourself. Ask another administrator.')).toBeVisible()

  // Escape closes it, like every other panel in the app.
  await page.keyboard.press('Escape')
  await expect(page.getByText('You cannot deactivate yourself. Ask another administrator.')).toHaveCount(0)

  // The trail is its own tab, not a column below the directory.
  await page.getByRole('tab', { name: 'Audit' }).click()
  await expect(page.getByRole('heading', { name: 'Audit' })).toBeVisible()
  await expect(page.getByText('90 days')).toBeVisible()
})

test('an administrator makes an invitation link, and takes it back', async ({ page }) => {
  await signInOnInstance(page, SELF_HOSTED, MAYA)
  await page.goto(`${SELF_HOSTED}/app?view=boards`)
  await page.getByRole('button', { name: /^Admin/ }).click()
  await page.getByRole('tab', { name: 'Invitations' }).click()
  await expect(page.getByRole('heading', { name: 'Invitations' })).toBeVisible()

  await page.getByRole('button', { name: 'Invite' }).click()
  const dialog = page.getByRole('dialog', { name: 'Invite somebody' })
  await dialog.getByPlaceholder('grace@example.com').fill('newcomer@example.com')
  await dialog.getByRole('textbox', { name: 'First name (optional)' }).fill('New')
  await dialog.getByRole('textbox', { name: 'Last name (optional)' }).fill('Comer')
  await page.getByRole('button', { name: 'Make the link' }).click()

  // Shown once, with the link selectable.
  await expect(page.getByText('This link is shown once.')).toBeVisible()
  const link = page.getByLabel('Invitation link')
  await expect(link).toHaveValue(/invite=/)

  await page.getByRole('button', { name: 'Done' }).click()
  // The optional name is carried on the invitation, beside the address it is for.
  await expect(page.getByRole('cell', { name: /newcomer@example\.com/ })).toContainText('New Comer')
  await expect(page.getByRole('cell', { name: 'newcomer@example.com' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'pending' })).toBeVisible()

  // Revoking is immediate and says so.
  await page.getByRole('button', { name: 'Revoke' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke' }).click()
  await expect(page.getByRole('cell', { name: 'revoked' })).toBeVisible()
})

test('a listed domain is a door, the selection is judged whole, and the directory leaves as a file', async ({ page, browser }) => {
  await signInOnInstance(page, SELF_HOSTED, MAYA)
  await page.goto(`${SELF_HOSTED}/app?view=boards`)
  await page.getByRole('button', { name: /^Admin/ }).click()

  // The list is a door, set through the API: Admin no longer has an Access tab.
  expect(
    (
      await page.request.patch(`${SELF_HOSTED}/api/admin/settings`, {
        data: { allowedDomains: ['trials.example'] },
      })
    ).ok(),
  ).toBeTruthy()

  // The file: the documented columns, and the filters the list is showing.
  await page.getByRole('tab', { name: 'People' }).click()
  const people = page.locator('section').filter({ has: page.getByRole('heading', { name: 'People' }) })
  const [download] = await Promise.all([page.waitForEvent('download'), people.getByRole('link', { name: 'Export CSV' }).click()])
  expect(download.suggestedFilename()).toMatch(/^kanbantoolkit-people-\d{4}-\d{2}-\d{2}\.csv$/)
  const file = await readFile((await download.path())!, 'utf8')
  expect(file.split('\r\n')[0]).toBe('name,email,role,status,last active,joined')
  expect(file).toContain('maya.blake@example.com')

  // A verified address from that domain walks in without an invitation, as a viewer.
  const other = await browser.newContext()
  try {
    const stranger = await other.newPage()
    await stranger.goto(`${SELF_HOSTED}/app`)
    await stranger.getByPlaceholder('you@example.com').fill('robin@trials.example')
    await stranger.getByRole('button', { name: 'Sign in as this address' }).click()
    await expect(stranger.getByRole('button', { name: /Robin/ })).toBeVisible()

    // A lookalike domain is not that domain: exact, never a suffix.
    await stranger.getByRole('button', { name: /Robin/ }).click()
    await stranger.getByRole('button', { name: 'Sign out' }).click()
    await expect(stranger.getByPlaceholder('you@example.com')).toBeVisible()
    await stranger.getByPlaceholder('you@example.com').fill('eve@nottrials.example')
    await stranger.getByRole('button', { name: 'Sign in as this address' }).click()
    // Still nobody signed in: the lookalike is not that domain.
    await expect(stranger.getByPlaceholder('you@example.com')).toBeVisible()
  } finally {
    await other.close()
  }

  // And the selection, which the server judges whole: the person just admitted can be closed out.
  await page.goto(`${SELF_HOSTED}/app?view=boards`)
  await page.getByRole('button', { name: /^Admin/ }).click()
  await page.getByRole('tab', { name: 'People' }).click()
  const list = page.locator('section').filter({ has: page.getByRole('heading', { name: 'People' }) })
  await expect(list.getByRole('cell', { name: /robin@trials\.example/ })).toBeVisible()
  await list.getByRole('checkbox', { name: 'Select Robin' }).check()
  await list.getByRole('button', { name: 'Deactivate' }).click()
  await expect(page.getByText('1 person changed.')).toBeVisible()
})
