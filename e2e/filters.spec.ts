import { expect, test } from '@playwright/test'
import { openBoard } from './support'

/**
 * A filter is a reading, not always an erasure.
 *
 * Dim keeps the rest of the board in view and only recedes it; Hide is the old narrowed board.
 * Counts and WIP still describe the whole lane either way.
 */
test('a filter is cleared from the sub-nav without losing the board', async ({ page }) => {
  await openBoard(page)
  await page.getByRole('button', { name: 'Filters' }).click()
  await page.getByPlaceholder(/Title or description contains/).fill('Migrate')
  await page.getByTitle('Close filters').click()

  await expect(page.getByRole('button', { name: 'Clear filters' })).toBeVisible()
  await expect(page.locator('[data-filter-dimmed]')).not.toHaveCount(0)
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(0)
  await expect(page.locator('[data-filter-dimmed]')).toHaveCount(0)
})

test('status includes late start, and choices with no active card are dimmed', async ({ page }) => {
  await openBoard(page)
  await page.getByRole('button', { name: 'Filters' }).click()

  // A type the board defines but no active card wears stays in the vocabulary, visibly disabled.
  const epic = page.getByRole('checkbox', { name: 'Epic' })
  await expect(epic).toBeDisabled()
  expect(await epic.evaluate((el) => el.closest('label')?.className)).toContain('opacity-40')

  // Late start is a status filter, and the seeded board has one card that carries it.
  const late = page.getByRole('checkbox', { name: /Late start/ })
  await expect(late).toBeEnabled()
  await late.check()
  const summary = page.locator('[data-filter-summary]')
  await expect(summary).toContainText('1 of')

  const lateCard = page.locator('[data-card-id="st-invoice-numbering"]')
  const other = page.locator('[data-card-id="st-usage-billing"]')
  await expect(lateCard).not.toHaveAttribute('data-filter-dimmed', '')
  await expect(other).toHaveAttribute('data-filter-dimmed', '')

  // Unowned is the ownership warning: In Progress and nobody assigned. The card says so too.
  await late.uncheck()
  const unowned = page.getByRole('checkbox', { name: /Unowned/ })
  await expect(unowned).toBeEnabled()
  await unowned.check()
  const ownerless = page.locator('[data-card-id="st-pricing-cache"]')
  await expect(ownerless).not.toHaveAttribute('data-filter-dimmed', '')
  await expect(ownerless).toContainText('Unowned')
  // A tag and a warning are different shapes and marks: a tag is a pill with a tag icon, a
  // warning is a rounded badge with a triangle.
  const tag = ownerless.getByTitle('Tag: tech-debt')
  await expect(tag).toHaveClass(/rounded-full/)
  await expect(tag.locator('svg')).toHaveCount(1)
  const warning = ownerless.getByTitle('It is in progress and nobody is assigned')
  await expect(warning).toContainText('Unowned')
  await expect(warning).not.toHaveClass(/rounded-full/)
  await expect(warning.locator('svg')).toHaveCount(1)
  await expect(other).toHaveAttribute('data-filter-dimmed', '')
})

test('card filters leave the other workflows whole, and say so', async ({ page }) => {
  await openBoard(page)
  await page.getByRole('button', { name: 'Filters' }).click()
  await expect(page.getByText('Card filters', { exact: true })).toBeVisible()

  await page.getByPlaceholder(/Title or description contains/).fill('Migrate')
  // The cards workflow narrows; the initiatives and external work remain as context, marked.
  const initiatives = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Initiatives workflow' }) })
  await expect(initiatives.locator('[data-not-filtered]')).toBeVisible()
  await expect(page.locator('[data-workflow="boundary"] [data-not-filtered]')).toBeVisible()

  // Clearing the card filter removes the marker: nothing is being excluded any more.
  await page.getByPlaceholder(/Title or description contains/).fill('')
  await expect(initiatives.locator('[data-not-filtered]')).toHaveCount(0)
  await expect(page.locator('[data-workflow="boundary"] [data-not-filtered]')).toHaveCount(0)
})

test('opening Filters from an open card replaces the drawer with the filter panel', async ({ page }) => {
  await openBoard(page)
  await page.locator('[data-workflow="cards"] [data-card-id]').first().click()
  await expect(page.locator('[data-item-panel]')).toBeVisible()
  const cardWidth = (await page.locator('[data-item-panel]').boundingBox())?.width

  // The filter toggle is excluded from the drawer's outside-click close, so the press does not
  // dismiss the drawer and move the button out from under the pointer before the click lands.
  await page.getByRole('button', { name: 'Filters' }).click()
  await expect(page.getByPlaceholder(/Title or description contains/)).toBeVisible()
  await expect(page.locator('[data-item-panel]')).toHaveCount(0)
  // It replaces the drawer in the same column, at the same width.
  expect((await page.locator('[data-filters-panel]').boundingBox())?.width).toBe(cardWidth)
})

test('non-matching cards dim by default, and Hide narrows the board', async ({ page }) => {
  await openBoard(page)
  await page.getByRole('button', { name: 'Filters' }).click()

  const modes = page.getByRole('group', { name: 'Filter mode' })
  await expect(modes.getByRole('button', { name: 'Dim' })).toHaveAttribute('aria-pressed', 'true')
  await expect(modes.getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-pressed', 'false')

  await page.getByPlaceholder(/Title or description contains/).fill('Migrate')
  const summary = page.locator('[data-filter-summary]')
  await expect(summary).toContainText('dimmed')
  await expect(summary).toContainText('of')

  // A card outside the filter is still on the board, and says so without being removed.
  const other = page.locator('[data-workflow="cards"] [data-card-id]').filter({ hasText: 'Add usage-based billing events' })
  await expect(other).toBeVisible()
  await expect(other).toHaveAttribute('data-filter-dimmed', '')
  await expect(other).toHaveAttribute('aria-label', /does not match the active filters/)

  // Hide takes it away; Dim brings it back.
  await modes.getByRole('button', { name: 'Hide' }).click()
  await expect(other).toHaveCount(0)
  await expect(summary).toContainText('Showing')
  await modes.getByRole('button', { name: 'Dim' }).click()
  await expect(other).toBeVisible()
  await expect(other).toHaveAttribute('data-filter-dimmed', '')

  // A dimmed card is still a card: close the filter panel, open it, and the drawer is the same.
  await page.getByTitle('Close filters').click()
  await other.click()
  await expect(page.locator('[data-item-panel]')).toBeVisible()
  await expect(page.getByLabel('Title')).toHaveValue('Add usage-based billing events')
})
