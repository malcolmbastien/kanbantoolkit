import { expect, test, type BrowserContext, type Page } from '@playwright/test'

/**
 * The live channel, both ways.
 *
 * One test opens the socket and watches a change arrive on a page that is never navigated; the
 * other does the same against an instance whose socket is switched off, so the *fallback* is a
 * tested path rather than a claim. Both sign the same person in twice — two devices, one workspace.
 */

// Its own instance: this spec writes a whole workspace, and a workspace is one per instance.
const SOCKET = 'http://localhost:4179'
const POLL = 'http://localhost:4175'

/**
 * Two browser contexts, four servers and a build on a two-core runner: every wait is bounded, so a
 * control that never arrives fails with a sentence instead of hanging until the test gives up.
 */
test.setTimeout(150_000)

async function signIn(page: Page, origin: string) {
  await page.goto(`${origin}/app`)
  // A page in a context that is already signed in says who it is; otherwise the instance's front door
  // is the sign-in screen itself.
  const account = page.getByRole('button', { name: /Maya Blake/ })
  const field = page.getByPlaceholder('you@example.com')

  await expect(account.or(field)).toBeVisible({ timeout: 20_000 })
  if (await account.isVisible()) return

  await field.fill('maya.blake@example.com')
  await page.getByRole('button', { name: 'Sign in as this address' }).click()
  await expect(account).toBeVisible({ timeout: 20_000 })
}

/**
 * The instance as the first device leaves it: a board, and one card to carry a change.
 *
 * Written through the two doors the app itself uses — an item, then the design that places it —
 * rather than by clicking through an empty workspace. The transport is what this spec is about, and
 * a board made by hand would only add minutes to it.
 */
async function boardWithCard(away: Page, origin: string): Promise<void> {
  const item = { id: 'i-live', title: 'A card', typeId: 't-story', createdAt: Date.now() }
  const made = await away.request.patch(`${origin}/api/workspace/items/${item.id}`, { data: { baseRev: 0, item } })
  expect(made.ok()).toBeTruthy()

  const design = {
    boards: [{ id: 'b-live', name: 'Team Atlas', band: 'team', description: '' }],
    lanes: [{ id: 'l-live', boardId: 'b-live', parentId: null, order: 0, name: 'Backlog', workflow: 'cards', stage: 'backlog' }],
    placements: [{ id: 'p-live', boardId: 'b-live', itemId: item.id, laneId: 'l-live', rank: 0 }],
  }
  const placed = await away.request.put(`${origin}/api/workspace/structure`, { data: { rev: 0, design } })
  expect(placed.ok()).toBeTruthy()
}

/**
 * Change a card in one context, and wait for the other to show it — never reloading the reader.
 *
 * The write is made with the first context's own session, which is the same thing a person does
 * through the drawer; what is under test here is the *transport*, so the edit is the smallest
 * honest one. The reader signs in after the workspace is in place, so both devices look at the same
 * card.
 */
async function editedElsewhereArrives(one: BrowserContext, two: BrowserContext, origin: string) {
  const away = await one.newPage()
  await signIn(away, origin)
  await boardWithCard(away, origin)

  const here = await two.newPage()
  await signIn(here, origin)
  // Straight to the board by its address: the workspace is the account's, and the board is there.
  await here.goto(`${origin}/app?board=b-live`)
  await expect(here.locator('[data-workflow="cards"] [data-card-id]').first()).toBeVisible({ timeout: 20_000 })

  const workspace = (await (await away.request.get(`${origin}/api/workspace`)).json()) as {
    items: Array<{ id: string; title: string; rev?: number }>
  }
  const item = workspace.items[0]
  const watch = here.locator(`[data-card-id="${item.id}"]`)
  await expect(watch).toBeVisible()

  const write = await away.request.patch(`${origin}/api/workspace/items/${item.id}`, {
    data: { baseRev: item.rev ?? 0, item: { ...item, title: 'Arrived live' } },
  })
  expect(write.ok()).toBeTruthy()

  // No reload: the second page is never navigated, and the card changes under it.
  await expect(watch).toContainText('Arrived live', { timeout: 15_000 })
}

test('a change reaches the other device over the socket, without a reload', async ({ browser }) => {
  const one = await browser.newContext()
  const two = await browser.newContext()

  try {
    const reader = await two.newPage()
    // The socket is a browser connection, so the assertion is made where the browser can see it.
    const cdp = await two.newCDPSession(reader)
    const sockets: string[] = []
    cdp.on('Network.webSocketCreated', (event: { url: string }) => sockets.push(event.url))
    await cdp.send('Network.enable')

    await signIn(reader, SOCKET)
    // This instance says it has a socket, and the browser opened one to the channel.
    const session = await (await reader.request.get(`${SOCKET}/api/auth/session`)).json()
    expect(session.live).toBe('socket')
    await expect.poll(() => sockets.some((url) => url.includes('/api/workspace/live'))).toBe(true)

    await editedElsewhereArrives(one, two, SOCKET)
  } finally {
    await one.close()
    await two.close()
  }
})

test('a change still arrives where there is no socket: the poll carries it', async ({ browser }) => {
  const one = await browser.newContext()
  const two = await browser.newContext()

  try {
    const reader = await two.newPage()
    const cdp = await two.newCDPSession(reader)
    const sockets: string[] = []
    cdp.on('Network.webSocketCreated', (event: { url: string }) => sockets.push(event.url))
    await cdp.send('Network.enable')

    await signIn(reader, POLL)
    const session = await (await reader.request.get(`${POLL}/api/auth/session`)).json()
    expect(session.live).toBe('poll')
    // Nothing was opened, because nothing offered: the fallback is the transport here.
    expect(sockets.filter((url) => url.includes('/api/workspace/live'))).toEqual([])

    await editedElsewhereArrives(one, two, POLL)
  } finally {
    await one.close()
    await two.close()
  }
})
