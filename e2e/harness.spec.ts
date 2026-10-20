import { expect, test } from '@playwright/test'
import { addCardTo, cardsIn, lane, openBoard } from './support'

/**
 * The harness itself: the app is served from its build, seeds its own workspace, and each test
 * gets an origin no other test has touched.
 */
test('the build seeds a workspace and draws both workflows', async ({ page }) => {
  const problems: string[] = []
  page.on('pageerror', (error) => problems.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text())
  })

  await openBoard(page)

  // Both workflows are the board: the initiatives on top, the team's cards below.
  await expect(page.locator('[data-workflow="initiatives"]')).toBeVisible()
  await expect(page.locator('[data-workflow="cards"]')).toBeVisible()
  await expect(page.locator('[data-card-id]').first()).toBeVisible()
  expect(await cardsIn(page, 'Backlog')).not.toHaveLength(0)

  // Nothing threw while it drew itself.
  expect(problems).toEqual([])
})

test('each test gets an empty origin, so the demo is seeded rather than inherited', async ({ browser, baseURL }) => {
  const first = await browser.newContext({ baseURL })
  const second = await browser.newContext({ baseURL })

  try {
    const a = await first.newPage()
    await openBoard(a)
    const before = await cardsIn(a, 'Backlog')
    await addCardTo(a, 'Backlog')
    await expect(lane(a, 'Backlog').locator('[data-card-id]')).toHaveCount(before.length + 1)

    // A second context has its own storage: the card the first one made is not here.
    const b = await second.newPage()
    await openBoard(b)
    await expect(lane(b, 'Backlog').locator('[data-card-id]')).toHaveCount(before.length)
    await expect(lane(b, 'Backlog').getByText('New card')).toHaveCount(0)
  } finally {
    await first.close()
    await second.close()
  }
})
