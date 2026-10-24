import { expect, test, type BrowserContext, type Page } from '@playwright/test'

/**
 * The live channel, both ways.
 *
 * One test opens the socket and watches a change arrive on a page that is never navigated; the
 * other does the same against an instance whose socket is switched off, so the *fallback* is a
 * tested path rather than a claim. Both sign the same person in twice — two devices, one workspace.
 */

const SOCKET = 'http://localhost:4174'
const POLL = 'http://localhost:4175'

async function signIn(page: Page, origin: string) {
  await page.goto(`${origin}/?board=b-atlas`)
  // A page in a context that is already signed in says who it is, and asking it to sign in again
  // would wait for a button that is not there.
  const account = page.getByRole('button', { name: /Maya Blake/ })
  if (await account.isVisible().catch(() => false)) return

  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByPlaceholder('you@example.com').fill('maya.blake@example.com')
  await page.getByRole('button', { name: 'Sign in as this address' }).click()
  await expect(account).toBeVisible()
}

/**
 * Change a card in one context, and wait for the other to show it — never reloading the reader.
 *
 * The write is made with the first context's own session, which is the same thing a person does
 * through the drawer; what is under test here is the *transport*, so the edit is the smallest
 * honest one. The reader signs in after the workspace is in place, so both devices look at the
 * same cards.
 *
 * A fresh instance has no workspace at all and offers to take the browser's on first sign-in; the
 * offer is taken here, because the point is what happens after the work exists.
 */
async function editedElsewhereArrives(one: BrowserContext, two: BrowserContext, origin: string) {
  const away = await one.newPage()
  await signIn(away, origin)

  const offer = away.getByRole('button', { name: 'Copy to account' })
  if (await offer.isVisible().catch(() => false)) {
    await offer.click()
    await away.getByRole('button', { name: 'Copy workspace' }).click()
    await expect
      .poll(async () => {
        const body = (await (await away.request.get(`${origin}/api/workspace`)).json()) as { boards: unknown[] }
        return body.boards.length
      })
      .toBeGreaterThan(0)
  }

  const here = await two.newPage()
  await signIn(here, origin)
  await expect(here.locator('[data-workflow="cards"] [data-card-id]').first()).toBeVisible()

  const workspace = (await (await away.request.get(`${origin}/api/workspace`)).json()) as {
    items: Array<{ id: string; title: string; rev?: number }>
  }
  const item = workspace.items[3]
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
