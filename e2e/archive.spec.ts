import { expect, test } from '@playwright/test'
import { openBoard } from './support'

/**
 * Filing work away has two words and one behaviour.
 *
 * A card whose work is done is *archived*; a card still in play is *discarded*, which drops it from
 * the board without claiming it was finished. Both leave the board the same way, both are in the
 * same archive, and both come back the same way — the difference is what the work *was*, and the
 * archive keeps exactly that and not the column it happened to sit in.
 */

/** Open a card's panel and its more-actions row. */
async function openMore(page: import('@playwright/test').Page, cardId: string) {
  await page.locator(`[data-card-id="${cardId}"]`).click()
  const panel = page.locator('[data-item-panel]')
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: /More — duplicate/ }).click()
  return panel
}

test('a card in play is discarded, and the archive says so without keeping its column', async ({ page }) => {
  await openBoard(page)

  // The card menu says the same word: one act, named by what the work is.
  await page.locator('[data-card-id="st-usage-billing"]').click({ button: 'right' })
  const menu = page.locator('[data-card-menu][role="menu"]').first()
  await expect(menu.getByRole('button', { name: 'Discard', exact: true })).toBeVisible()
  await expect(menu.getByRole('button', { name: 'Archive', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')

  // A card in Backlog: there is nothing to archive, so the panel offers the honest word.
  const panel = await openMore(page, 'st-usage-billing')
  await expect(panel.getByRole('button', { name: 'Discard' })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Archive', exact: true })).toHaveCount(0)
  await panel.getByRole('button', { name: 'Discard' }).click()

  // It leaves the board…
  await expect(page.locator('[data-card-id="st-usage-billing"]')).toHaveCount(0)

  // …and the archive holds it as discarded, with no column status beside it.
  await page.goto('/app?board=b-atlas&view=archive')
  const row = page.locator('tr', { hasText: 'Add usage-based billing events' })
  await expect(row).toBeVisible()
  await expect(row.getByText('Discarded')).toBeVisible()
  await expect(row.getByText('Backlog')).toHaveCount(0)

  // A row is a way into the item, not only a line in a table.
  await row.click()
  const drawer = page.locator('[data-item-panel]')
  await expect(drawer).toBeVisible()
  expect(await drawer.getAttribute('aria-label')).toContain('Add usage-based billing events')

  // The drawer is read-only in the archive.
  await expect(drawer.getByLabel('Title')).toBeDisabled()
  await expect(drawer.getByText(/archived, so it is read-only/)).toBeVisible()
  await expect(drawer.getByRole('button', { name: 'Mark blocked' })).toHaveCount(0)
  // Read-only fields, but the one action that brings it back is still there.
  await expect(drawer.getByRole('button', { name: 'Restore' })).toBeVisible()

  // Pressing on another row is not a click on the backdrop: the drawer must not close before the
  // row's own click opens the next item.
  const other = page.locator('tr', { hasText: 'Rate limit messaging' })
  await expect(other).toBeVisible()
  await other.dispatchEvent('mousedown')
  await expect(drawer).toBeVisible()
  expect(await drawer.getAttribute('aria-label')).toContain('Add usage-based billing events')
  await other.click()
  await expect(drawer).toHaveAttribute('aria-label', /Rate limit messaging/)

  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
})

test('an archived initiative is read-only and raises no warnings', async ({ page }) => {
  await openBoard(page)
  await page.locator('[data-card-id="init-billing"]').first().click()
  const panel = page.locator('[data-item-panel]')
  await expect(panel.getByText(/^\d+ warnings?$/)).toBeVisible()

  // Discard it: it leaves play, and its warnings leave with it.
  await panel.getByRole('button', { name: /More — duplicate/ }).click()
  await panel.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(panel.getByText(/^\d+ warnings?$/)).toHaveCount(0)
  await expect(panel.getByLabel('Title')).toBeDisabled()
  await expect(panel.getByText(/archived, so it is read-only/)).toBeVisible()

  await page.keyboard.press('Escape')
  await page.goto('/app?board=b-atlas&view=archive')
  const row = page.locator('tr', { hasText: 'Billing migration' })
  await expect(row).toBeVisible()
  await row.click()
  const drawer = page.locator('[data-item-panel]')
  await expect(drawer).toBeVisible()
  await expect(drawer.getByText(/^\d+ warnings?$/)).toHaveCount(0)
  await expect(drawer.getByLabel('Title')).toBeDisabled()
})

test('done work is archived, and restoring it puts the card back in play', async ({ page }) => {
  await openBoard(page)

  // The board's Done cell: finished work, so the offer is Archive.
  const panel = await openMore(page, 'st-signup-screens')
  await expect(panel.getByRole('button', { name: 'Archive', exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Discard' })).toHaveCount(0)
  await panel.getByRole('button', { name: 'Archive', exact: true }).click()

  await expect(page.locator('[data-card-id="st-signup-screens"]')).toHaveCount(0)

  await page.goto('/app?board=b-atlas&view=archive')
  const row = page.locator('tr', { hasText: 'Design the signup screens' })
  await expect(row).toBeVisible()
  await expect(row.getByText('Completed')).toBeVisible()

  // Restored, it is back on its board and the archive's verdict is gone with the filing.
  await row.getByRole('button', { name: /Restore/ }).click()
  await expect(row).toHaveCount(0)
  // Restoring is its own action; the row's drawer does not open behind it.
  await expect(page.locator('[data-item-panel]')).toHaveCount(0)
  await openBoard(page)
  await expect(page.locator('[data-card-id="st-signup-screens"]')).toHaveCount(1)
})
