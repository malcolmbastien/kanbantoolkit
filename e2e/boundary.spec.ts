import { expect, test } from '@playwright/test'
import { openBoard } from './support'

/**
 * Boundary work is a workflow below the cards (task 174).
 *
 * The demo board has real boundary dependencies — Team Atlas waits on Team Nova's identity platform
 * and a few others — so this is the seeded truth rather than a fixture invented for the test.
 */

test('boundary work is a workflow below the cards, in the four typed stages', async ({ page }) => {
  await openBoard(page)

  const workflow = page.locator('[data-workflow="boundary"]')
  await expect(workflow).toBeVisible()
  // Below the cards workflow, not beside it: the rail is gone.
  const afterCards = await workflow.evaluate((element) => {
    const cards = document.querySelector('[data-workflow="cards"]')
    return Boolean(cards && cards.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
  })
  expect(afterCards).toBe(true)

  for (const stage of ['backlog', 'notStarted', 'inProgress', 'done']) {
    await expect(page.locator(`[data-boundary-stage="${stage}"]`)).toBeVisible()
  }

  // It is a lens: nothing in it is a card on this board, so nothing leaks into a count or a drag.
  await expect(workflow.locator('[data-card-id]')).toHaveCount(0)
  // …and the old sticky rail is gone.
  await expect(page.locator('[aria-label="Boundary — waiting on"]')).toHaveCount(0)
})

test('both ends name each other, and either one enters the focus state', async ({ page }) => {
  await openBoard(page)

  const identity = page.locator('[data-boundary-card="init-identity"]')
  await expect(identity).toBeVisible()
  // The boundary card names the card on this board that waits on it.
  const dependentLink = identity.getByRole('button', { name: 'Add SSO for enterprise tenants' })
  await expect(dependentLink).toBeVisible()

  // …and that card wears the chips, without anything being selected first. It waits on two
  // external things, and each is named — a count would have hidden one of them.
  const sso = page.locator('[data-card-id="st-enterprise-sso"]')
  await expect(sso.locator('[data-waiting-on] button')).toHaveCount(2)

  // The card itself is the control: pressing its face selects it, with no separate button to find.
  const title = identity.getByRole('button', { name: 'Identity platform', exact: true })
  await identity.getByText('Open · live blockage').click()
  await expect(title).toHaveAttribute('aria-pressed', 'true')
  await expect(identity).toContainText('linked')
  // Unrelated cards recede while the relationship is the thing being read.
  await expect(page.locator('[data-card-id="st-usage-billing"]')).toHaveClass(/opacity-40/)

  // The same face clears it: one control, two states.
  await identity.getByText('Open · live blockage').click()
  await expect(title).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('[data-card-id="st-usage-billing"]')).not.toHaveClass(/opacity-40/)

  // Keyboard: the name is a button, so Enter does what the click did.
  await title.focus()
  await page.keyboard.press('Enter')
  await expect(title).toHaveAttribute('aria-pressed', 'true')
  await expect(identity).toContainText('linked')

  // From the other end, the chip selects the same card and takes the reader to it.
  await identity.getByText('Open · live blockage').click()
  await expect(title).toHaveAttribute('aria-pressed', 'false')
  await sso.getByRole('button', { name: 'Waiting on Identity platform' }).click()
  await expect(title).toHaveAttribute('aria-pressed', 'true')
})

test('clicking away ends the focus, and a card takes it over', async ({ page }) => {
  await openBoard(page)

  const identity = page.locator('[data-boundary-card="init-identity"]')
  const title = identity.getByRole('button', { name: 'Identity platform', exact: true })
  const other = page.locator('[data-card-id="st-usage-billing"]')

  // Focus a boundary card: everything else recedes.
  await identity.getByText('Open · live blockage').click()
  await expect(title).toHaveAttribute('aria-pressed', 'true')
  await expect(other).toHaveClass(/opacity-40/)

  // Selecting another card ends the focus and does what a card does: it opens its drawer.
  await other.click()
  await expect(title).toHaveAttribute('aria-pressed', 'false')
  await expect(other).not.toHaveClass(/opacity-40/)
  await expect(page.locator('[data-item-panel]')).toHaveAttribute(
    'aria-label',
    'Card details: Add usage-based billing events',
  )
  await page.keyboard.press('Escape')

  // Clicking the board's ground ends it too, and opens nothing.
  await identity.getByText('Open · live blockage').click()
  await expect(title).toHaveAttribute('aria-pressed', 'true')
  await page.locator('[data-workflow="cards"]').first().click({ position: { x: 4, y: 4 } })
  await expect(title).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('[data-item-panel]')).toHaveCount(0)
})

test('the four stages stay in one row, and the row scrolls instead of wrapping', async ({ page }) => {
  // Wide enough for four columns: they share the width and the row does not scroll.
  await page.setViewportSize({ width: 1400, height: 900 })
  await openBoard(page)
  const row = page.locator('[data-boundary-stage="backlog"]').locator('..')
  await expect(row).toBeVisible()
  await row.scrollIntoViewIfNeeded()

  const stages = () =>
    page
      .locator('[data-boundary-stage]')
      .evaluateAll((elements) =>
        elements.map((element) => ({
          stage: (element as HTMLElement).dataset.boundaryStage ?? '',
          top: Math.round(element.getBoundingClientRect().top),
          left: Math.round(element.getBoundingClientRect().left),
        })),
      )
  const rowWidths = () => row.evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }))

  const wide = await stages()
  expect(wide).toHaveLength(4)
  // One row, left to right in the typed order: a stage that wrapped would share a `top` with none
  // of its neighbours and start left of the one before it.
  expect(new Set(wide.map((s) => s.top)).size, 'all four stages sit on one row').toBe(1)
  expect(wide.map((s) => s.stage)).toEqual(['backlog', 'notStarted', 'inProgress', 'done'])
  expect(wide.map((s) => s.left)).toEqual([...wide.map((s) => s.left)].sort((a, b) => a - b))
  expect((await rowWidths()).scroll, 'four columns fit, so nothing scrolls').toBeLessThanOrEqual(
    (await rowWidths()).client + 1,
  )

  // Narrow enough that four columns cannot share it: still one row, and the row is the scroller.
  await page.setViewportSize({ width: 640, height: 900 })
  await row.scrollIntoViewIfNeeded()
  const narrow = await stages()
  expect(new Set(narrow.map((s) => s.top)).size, 'still one row when the page is narrow').toBe(1)
  await expect(row).toHaveCSS('overflow-x', 'auto')
  const widths = await rowWidths()
  expect(widths.scroll, 'the row is wider than the space, so it scrolls').toBeGreaterThan(widths.client + 8)

  // The last stage is reachable, which is what the sideways scroll is for.
  await row.evaluate((element) => {
    element.scrollLeft = element.scrollWidth
  })
  await expect(page.locator('[data-boundary-stage="done"]')).toBeInViewport()
})

test('a coordination board has no boundary workflow', async ({ page }) => {
  // The programme board renders bands, not a cards workflow: there is no edge of *this* board to show.
  await page.goto('/app?board=b-delivery')
  await expect(page.locator('[data-workflow="initiatives"]').first()).toBeVisible()
  await expect(page.locator('[data-workflow="boundary"]')).toHaveCount(0)
})
