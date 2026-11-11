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
  // The band says what it is: linked work from other boards.
  await expect(workflow.getByRole('heading', { name: 'External dependencies' })).toBeVisible()
})

test('a dependency card names the cards here that wait on it, and each counts what it waits for', async ({ page }) => {
  await openBoard(page)

  const identity = page.locator('[data-boundary-card="init-identity"]')
  await expect(identity).toBeVisible()
  // Every boundary card is already a dependency; its live/planning state is not repeated on it.
  await expect(identity).not.toContainText('Open · live blockage')
  await expect(identity).not.toContainText('planning risk')
  // The boundary card names the card on this board that waits on it.
  const dependentLink = identity.getByRole('button', { name: 'Add SSO for enterprise tenants' })
  await expect(dependentLink).toBeVisible()

  // …and that card reads its wait as one summary badge, not a chip per dependency. It waits on
  // two external things, and the card's panel is where they are named.
  const sso = page.locator('[data-card-id="st-enterprise-sso"]')
  const count = sso.locator('[data-open-dependencies]')
  await expect(count).toHaveAttribute('data-open-dependencies', '2')
  await expect(count).toHaveAttribute('aria-label', /^2 open dependencies/)

  // The card itself is the control: pressing its face selects it, with no separate button to find.
  const title = identity.getByRole('button', { name: 'Identity platform', exact: true })
  await title.click()
  await expect(title).toHaveAttribute('aria-pressed', 'true')
  await expect(identity).toContainText('linked')
  // Unrelated cards recede while the relationship is the thing being read.
  await expect(page.locator('[data-card-id="st-usage-billing"]')).toHaveClass(/opacity-40/)

  // The same face clears it: one control, two states.
  await title.click()
  await expect(title).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('[data-card-id="st-usage-billing"]')).not.toHaveClass(/opacity-40/)

  // Keyboard: the name is a button, so Enter does what the click did.
  await title.focus()
  await page.keyboard.press('Enter')
  await expect(title).toHaveAttribute('aria-pressed', 'true')
  await expect(identity).toContainText('linked')
})

test('the count includes work this board waits on itself, not only its external dependencies', async ({ page }) => {
  // Cost attribution waits on the lakehouse pipeline, and both live on Team Nova.
  await openBoard(page, '/app?board=b-nova')
  const attribution = page.locator('[data-card-id="st-cost-attribution"]')
  const count = attribution.locator('[data-open-dependencies]')
  await expect(count).toHaveAttribute('data-open-dependencies', '1')
  await expect(count).toHaveAttribute('aria-label', /^1 open dependency/)
})

test('the dependency badge opens the Hierarchy tab with this item’s connections showing', async ({ page }) => {
  await openBoard(page)

  const sso = page.locator('[data-card-id="st-enterprise-sso"]')
  const badge = sso.locator('[data-open-dependencies]')
  await expect(badge).toHaveAttribute('data-open-dependencies', '2')
  await badge.click()

  const panel = page.locator('[data-item-panel]')
  await expect(panel).toHaveAttribute('aria-label', 'Card details: Add SSO for enterprise tenants')
  // The face asked for is Hierarchy, not the Overview every other door opens on.
  await expect(panel.getByRole('button', { name: 'Hierarchy' })).toHaveClass(/text-indigo-600/)
  await expect(panel.getByRole('button', { name: 'Add a dependency' })).toBeVisible()
  // The Connections lens is scoped to this item, and its strings are on the board behind it.
  await expect(panel.getByTitle(/Hide this item.s connections/)).toBeVisible()
  await expect(page.locator('[data-connection-link]').first()).toBeVisible()
})

test('a selected boundary card draws the same dependency string the lens draws', async ({ page }) => {
  await openBoard(page)
  const identity = page.locator('[data-boundary-card="init-identity"]')
  const title = identity.getByRole('button', { name: 'Identity platform', exact: true })
  const sso = page.locator('[data-card-id="st-enterprise-sso"]')
  await expect(sso).toBeAttached()
  const edge = 'boundary:init-identity:st-enterprise-sso'
  const link = page.locator(`[data-connection-link="${edge}"]`)
  // The connector as drawn: red, the dependency weight, with the arrow that says which end is
  // waited on. Nothing about it changes with the way the reading was asked for.
  const drawn = () =>
    link.locator('path').evaluate((el) => ({
      stroke: el.getAttribute('stroke'),
      width: el.getAttribute('stroke-width'),
      marker: el.getAttribute('marker-end'),
      opacity: el.getAttribute('stroke-opacity'),
    }))

  // At rest the boundary is a list, and the lens is off. The string is a reading, not a fixture.
  await expect(page.locator('[data-connection-link]')).toHaveCount(0)

  // What the Connections toggle draws for this edge is the definition of the connector.
  await page.getByRole('button', { name: 'Connections', exact: true }).click()
  await expect(link).toHaveCount(1)
  const fromLens = await drawn()
  expect(fromLens.stroke).toBe('#dc2626')
  expect(fromLens.width).toBe('2.5')
  expect(fromLens.marker).toContain('dependency')
  await expect(link).toHaveAttribute('data-connection-kind', 'dependency')
  // The attributes carry the model's direction (blocker → waiting item); the drawing turns it
  // round, so the circle starts on the waiting card and the arrow lands on the boundary card.
  await expect(link).toHaveAttribute('data-connection-from', 'init-identity')
  await expect(link).toHaveAttribute('data-connection-to', 'st-enterprise-sso')
  await page.getByRole('button', { name: 'Connections', exact: true }).click()
  await expect(page.locator('[data-connection-link]')).toHaveCount(0)

  // Selecting the boundary card asks for the same edge, drawn the same way: the circle leaves the
  // waiting card and the arrow lands on the boundary card below.
  await title.click()
  await expect(identity).toContainText('linked')
  await expect(link).toHaveCount(1)
  expect(await drawn()).toEqual(fromLens)
  await expect(link.locator('[data-connection-start]')).toHaveCount(1)

  // Clearing the selection takes the string with it.
  await title.click()
  await expect(identity).not.toContainText('linked')
  await expect(page.locator('[data-connection-link]')).toHaveCount(0)
})

test('clicking away ends the focus, and a card takes it over', async ({ page }) => {
  await openBoard(page)

  const identity = page.locator('[data-boundary-card="init-identity"]')
  const title = identity.getByRole('button', { name: 'Identity platform', exact: true })
  const other = page.locator('[data-card-id="st-usage-billing"]')

  // Focus a boundary card: everything else recedes.
  await title.click()
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
  await title.click()
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
  const lefts = wide.map((s) => s.left)
  expect(lefts, 'the stages read left to right in their typed order').toEqual([...lefts].sort((a, b) => a - b))
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
