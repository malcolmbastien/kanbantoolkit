import { expect, test } from '@playwright/test'

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

  // Offered, not taken: the account has no workspace, this browser has one.
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
