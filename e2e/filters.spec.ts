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
