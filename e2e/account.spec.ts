import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

// These three share one instance and its database, and each edits a card; run them in order so a
// rename in one is never a surprise in another.
test.describe.configure({ mode: 'serial' })

/**
 * The account control, against the self-hosted entry.
 *
 * The dev switch stands in for a provider on purpose: it is the one identity that needs no outside
 * service, and the flow after it — session cookie, reload, sign-out — is the same flow a real
 * provider's callback ends in.
 */
const SELF_HOSTED = 'http://localhost:4174'

test('a person signs in, stays signed in across a reload, and signs out', async ({ page }) => {
  await page.goto(SELF_HOSTED)

  const signIn = page.getByRole('button', { name: 'Sign in' })
  await expect(signIn).toBeVisible()

  await signIn.click()
  await page.getByPlaceholder('you@example.com').fill('maya.blake@example.com')
  await page.getByRole('button', { name: 'Sign in as this address' }).click()

  // The account becomes the workspace's own person of that name, so "my work" and the author on a
  // change are right while the workspace is still local.
  const account = page.getByRole('button', { name: /Maya Blake/ })
  await expect(account).toBeVisible()

  await page.reload()
  await expect(page.getByRole('button', { name: /Maya Blake/ })).toBeVisible()

  await page.getByRole('button', { name: /Maya Blake/ }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
})

test('an edit made while signed in reaches the server', async ({ page }) => {
  // The team board, because that is the one whose cards are cards.
  await page.goto(`${SELF_HOSTED}/?board=b-atlas`)

  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByPlaceholder('you@example.com').fill('maya.blake@example.com')
  await page.getByRole('button', { name: 'Sign in as this address' }).click()
  await expect(page.getByRole('button', { name: /Maya Blake/ })).toBeVisible()

  // A card's own content, changed the way a person changes it.
  await page.locator('[data-workflow="cards"] [data-card-id]').first().click()
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
  await page.goto(`${SELF_HOSTED}/?board=b-atlas`)

  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByPlaceholder('you@example.com').fill('maya.blake@example.com')
  await page.getByRole('button', { name: 'Sign in as this address' }).click()
  await expect(page.getByRole('button', { name: /Maya Blake/ })).toBeVisible()

  // A card the server has not seen, so this test is about the queue rather than about a conflict
  // with the edit the test above made. It is also opened while there is a line: the drawer is its
  // own chunk (task 110), and a first open with no connection is a different failure.
  await page.locator('[data-workflow="cards"] [data-card-id]').nth(1).click()
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
    const here = await two.newPage()

    for (const page of [away, here]) {
      await page.goto(`${SELF_HOSTED}/?board=b-atlas`)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await page.getByPlaceholder('you@example.com').fill('maya.blake@example.com')
      await page.getByRole('button', { name: 'Sign in as this address' }).click()
      await expect(page.getByRole('button', { name: /Maya Blake/ })).toBeVisible()
    }

    // The same card in both — the demo seeds the same ids on both origins.
    const elsewhere = away.locator('[data-workflow="cards"] [data-card-id]').nth(3)
    const id = await elsewhere.getAttribute('data-card-id')
    const watch = here.locator(`[data-card-id="${id}"]`)

    await elsewhere.click()
    await away.getByLabel('Title').fill('Arrived live')

    // No reload: the second page is never navigated, and the card changes under it.
    await expect(watch).toContainText('Arrived live', { timeout: 15_000 })
  } finally {
    await one.close()
    await two.close()
  }
})

test('a local workspace can be copied to the account on first sign-in', async ({ page }) => {
  await page.goto(`${SELF_HOSTED}/?board=b-atlas`)

  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByPlaceholder('you@example.com').fill('maya.blake@example.com')
  await page.getByRole('button', { name: 'Sign in as this address' }).click()
  await expect(page.getByRole('button', { name: /Maya Blake/ })).toBeVisible()

  // Offered, not taken: the account has no workspace, this browser has one. A retry of this test
  // runs against the instance the first attempt already copied to, where the work is done.
  const copied = await page.request.get(`${SELF_HOSTED}/api/workspace`)
  const already = ((await copied.json()) as { boards: unknown[] }).boards.length > 0
  if (already) return

  const offer = page.getByRole('button', { name: 'Copy to account' })
  await expect(offer).toBeVisible()
  await offer.click()
  await page.getByRole('button', { name: 'Copy workspace' }).click()

  // The account now has the workspace the browser was working in.
  await expect
    .poll(async () => {
      const body = (await (await page.request.get(`${SELF_HOSTED}/api/workspace`)).json()) as { boards: unknown[] }
      return body.boards.length
    })
    .toBeGreaterThan(0)

  // And the copy here was not taken away: the board still draws.
  await expect(page.locator('[data-workflow="cards"]')).toBeVisible()
})

test('one person holds a card, and the other can see it is held, then free', async ({ browser }) => {
  const one = await browser.newContext()
  const two = await browser.newContext()

  try {
    const holder = await one.newPage()
    const reader = await two.newPage()

    // One person, two tabs: the instance closes behind its first account (task 134), and the lease
    // is keyed by session precisely so that this case — one person with two of them — is told rather
    // than locked out.
    for (const page of [holder, reader]) {
      const who = 'maya.blake@example.com'
      await page.goto(`${SELF_HOSTED}/?board=b-atlas`)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await page.getByPlaceholder('you@example.com').fill(who)
      await page.getByRole('button', { name: 'Sign in as this address' }).click()
      await expect(page.getByRole('button', { name: /Maya Blake/ })).toBeVisible()
    }

    const spot = 5
    const card = holder.locator('[data-workflow="cards"] [data-card-id]').nth(spot)
    const id = await card.getAttribute('data-card-id')
    await card.click()

    // Edit intent, not opening: putting the caret in the title is what takes the pen.
    await holder.getByLabel('Title').click()

    const locks = async () => {
      const feed = (await (await reader.request.get(`${SELF_HOSTED}/api/workspace/changes?since=0`)).json()) as {
        locks: Array<{ itemId: string; holderName: string }>
      }
      return feed.locks
    }

    // The other client hears about it on the same feed its drawer reads.
    await expect.poll(async () => (await locks()).some((lock) => lock.itemId === id && lock.holderName === 'Maya Blake')).toBe(true)

    // The pen is refused to anybody else.
    const refused = await reader.request.patch(`${SELF_HOSTED}/api/workspace/items/${id}`, {
      headers: { 'content-type': 'application/json', 'x-flowline-tab': 'reader' },
      data: { baseRev: 0, item: { id, title: 'Mine', typeId: 't-card', createdAt: 1 } },
    })
    expect(refused.status()).toBe(423)

    // Letting go releases it, and the feed says so.
    await holder.getByRole('button', { name: 'Close' }).click()
    await expect.poll(async () => (await locks()).some((lock) => lock.itemId === id)).toBe(false)
  } finally {
    await one.close()
    await two.close()
  }
})

test('an administrator sees the people, and cannot close their own door', async ({ page }) => {
  await page.goto(`${SELF_HOSTED}/?board=b-atlas`)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByPlaceholder('you@example.com').fill('maya.blake@example.com')
  await page.getByRole('button', { name: 'Sign in as this address' }).click()
  await expect(page.getByRole('button', { name: /Maya Blake/ })).toBeVisible()

  // Through the workspace, which is the only way in — and the way a person actually arrives. (A
  // direct `?view=admin` is raced by the account's workspace being adopted on sign-in, which resets
  // the view to the board.)
  await page.goto(`${SELF_HOSTED}/?view=boards`)
  await page.getByRole('button', { name: /^Admin/ }).click()
  await expect(page.getByRole('heading', { name: 'People' })).toBeVisible()
  // The trail and the health of the instance, on the same screen.
  await expect(page.getByRole('heading', { name: 'Audit' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Health' })).toBeVisible()
  await expect(page.getByText('90 days')).toBeVisible()
  // Two tables now — the workspace's members and the instance's people — so the assertion names
  // which one it means.
  const people = page.locator('section').filter({ has: page.getByRole('heading', { name: 'People' }) })
  await expect(people.getByRole('table')).toContainText('maya.blake@example.com')

  // The drawer explains the guard before the server has to refuse it. Maya's own row, by name:
  // other specs add people to this instance, and "the first row" is a name that sorts early.
  await people.getByRole('button', { name: 'Open Maya Blake' }).click()
  await expect(page.getByText('You cannot deactivate yourself. Ask another administrator.')).toBeVisible()

  // Escape closes it, like every other panel in the app.
  await page.keyboard.press('Escape')
  await expect(page.getByText('You cannot deactivate yourself. Ask another administrator.')).toHaveCount(0)
})

test('an administrator makes an invitation link, and takes it back', async ({ page }) => {
  await page.goto(`${SELF_HOSTED}/?board=b-atlas`)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByPlaceholder('you@example.com').fill('maya.blake@example.com')
  await page.getByRole('button', { name: 'Sign in as this address' }).click()
  await expect(page.getByRole('button', { name: /Maya Blake/ })).toBeVisible()

  await page.goto(`${SELF_HOSTED}/?view=boards`)
  await page.getByRole('button', { name: /^Admin/ }).click()
  await expect(page.getByRole('heading', { name: 'Invitations' })).toBeVisible()

  await page.getByRole('button', { name: 'Invite' }).click()
  await page.getByRole('dialog', { name: 'Invite somebody' }).getByPlaceholder('grace@example.com').fill('newcomer@example.com')
  await page.getByRole('button', { name: 'Make the link' }).click()

  // Shown once, with the link selectable.
  await expect(page.getByText('This link is shown once.')).toBeVisible()
  const link = page.getByLabel('Invitation link')
  await expect(link).toHaveValue(/invite=/)

  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('cell', { name: 'newcomer@example.com' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'pending' })).toBeVisible()

  // Revoking is immediate and says so.
  await page.getByRole('button', { name: 'Revoke' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke' }).click()
  await expect(page.getByRole('cell', { name: 'revoked' })).toBeVisible()
})

test('a listed domain is a door, the selection is judged whole, and the directory leaves as a file', async ({ page, browser }) => {
  await page.goto(`${SELF_HOSTED}/?board=b-atlas`)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByPlaceholder('you@example.com').fill('maya.blake@example.com')
  await page.getByRole('button', { name: 'Sign in as this address' }).click()
  await expect(page.getByRole('button', { name: /Maya Blake/ })).toBeVisible()

  await page.goto(`${SELF_HOSTED}/?view=boards`)
  await page.getByRole('button', { name: /^Admin/ }).click()
  await expect(page.getByRole('heading', { name: 'Access' })).toBeVisible()

  // The list is a door, and the screen says so before it is opened.
  await page.getByLabel('Domains admitted without an invitation').fill('trials.example')
  await page.getByRole('button', { name: 'Save the list' }).click()
  await expect(page.getByText('Saved, and recorded in the audit.')).toBeVisible()

  // The file: the documented columns, and the filters the list is showing.
  const people = page.locator('section').filter({ has: page.getByRole('heading', { name: 'People' }) })
  const [download] = await Promise.all([page.waitForEvent('download'), people.getByRole('link', { name: 'Export CSV' }).click()])
  expect(download.suggestedFilename()).toMatch(/^flowline-people-\d{4}-\d{2}-\d{2}\.csv$/)
  const file = await readFile((await download.path())!, 'utf8')
  expect(file.split('\r\n')[0]).toBe('name,email,role,status,last active,joined')
  expect(file).toContain('maya.blake@example.com')

  // A verified address from that domain walks in without an invitation, as a viewer.
  const other = await browser.newContext()
  try {
    const stranger = await other.newPage()
    await stranger.goto(SELF_HOSTED)
    await stranger.getByRole('button', { name: 'Sign in', exact: true }).click()
    await stranger.getByPlaceholder('you@example.com').fill('robin@trials.example')
    await stranger.getByRole('button', { name: 'Sign in as this address' }).click()
    await expect(stranger.getByRole('button', { name: /Robin/ })).toBeVisible()

    // A lookalike domain is not that domain: exact, never a suffix.
    await stranger.getByRole('button', { name: /Robin/ }).click()
    await stranger.getByRole('button', { name: 'Sign out' }).click()
    await stranger.getByRole('button', { name: 'Sign in', exact: true }).click()
    await stranger.getByPlaceholder('you@example.com').fill('eve@nottrials.example')
    await stranger.getByRole('button', { name: 'Sign in as this address' }).click()
    // Still nobody signed in: the lookalike is not that domain.
    await expect(stranger.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
    await expect(stranger.getByPlaceholder('you@example.com')).toBeVisible()
  } finally {
    await other.close()
  }

  // And the selection, which the server judges whole: the person just admitted can be closed out.
  await page.goto(`${SELF_HOSTED}/?view=boards`)
  await page.getByRole('button', { name: /^Admin/ }).click()
  const list = page.locator('section').filter({ has: page.getByRole('heading', { name: 'People' }) })
  await expect(list.getByRole('cell', { name: /robin@trials\.example/ })).toBeVisible()
  await list.getByRole('checkbox', { name: 'Select Robin' }).check()
  await list.getByRole('button', { name: 'Deactivate' }).click()
  await expect(page.getByText('1 person changed.')).toBeVisible()
})
