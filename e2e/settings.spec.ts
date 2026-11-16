import { expect, test } from '@playwright/test'
import { openBoard } from './support'

/**
 * A board's CSV export belongs with the board's settings, not among the controls a reader uses to
 * read and move the work.
 */
test('a board exports its cards from Board settings, not the working toolbar', async ({ page }) => {
  await openBoard(page)
  await expect(page.getByRole('button', { name: 'Export CSV' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.locator('[data-board-settings]')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Export', { exact: true })).toBeVisible()

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Export CSV' }).click(),
  ])
  expect(download.suggestedFilename()).toBe('team-atlas-cards.csv')

  await dialog.getByRole('button', { name: 'Close board settings' }).click()
  await expect(dialog).toHaveCount(0)
  // The working bar still carries the board's reading controls.
  await expect(page.getByRole('button', { name: 'Filters' })).toBeVisible()
})
