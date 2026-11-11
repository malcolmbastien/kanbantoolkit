import { expect, test } from '@playwright/test'
import { openBoard } from './support'

/**
 * Filing work away has two words and one behaviour.
 *
 * A card whose work is done is *archived*; a card still in play is *discarded*, which drops it from
 * the board without claiming it was finished. Both leave the board the same way, both are in the
 * board's archive, and both come back the same way — the difference is what the work *was*, and the
 * archive keeps exactly that and not the column it happened to sit in.
 */

/** Open a card's panel and its more-actions row. */
async function openMore(page: import('@playwright/test').Page, cardId: string) {
  await page.locator(`[data-card-id="${cardId}"]`).click()
  const panel = page.locator('[data-item-panel]')
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: 'More', exact: true }).click()
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
  await expect(drawer.getByText(/read-only until you restore it/)).toBeVisible()
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

test('a discarded child stays in the drawer, not as a warning on the initiative card', async ({ page }) => {
  await openBoard(page)

  // A card under Billing migration: discarding it is allowed, and does not trap the initiative in
  // an impossible completion.
  await page.locator('[data-card-id="st-usage-billing"]').click()
  const childPanel = page.locator('[data-item-panel]')
  await childPanel.getByRole('button', { name: 'More', exact: true }).click()
  await childPanel.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(page.locator('[data-card-id="st-usage-billing"]')).toHaveCount(0)
  await page.keyboard.press('Escape')

  // The parent stays live without wearing the count on its face.
  const initiative = page.locator('[data-workflow="initiatives"] [data-card-id="init-billing"]')
  await expect(initiative).toBeVisible()
  await expect(initiative).not.toContainText('1 discarded')

  // The drawer still holds the decision: the warning names it, and Hierarchy names the card.
  await initiative.click()
  const drawer = page.locator('[data-item-panel]')
  await expect(drawer).toHaveAttribute('aria-label', 'Card details: Billing migration')
  await expect(drawer.getByText('1 discarded')).toBeVisible()
  await drawer.getByRole('button', { name: 'Hierarchy' }).click()
  await expect(drawer.getByText('Add usage-based billing events')).toBeVisible()
  await expect(drawer.getByText('discarded', { exact: true })).toBeVisible()
})

test('each board’s archive lists only the work filed from that board', async ({ page }) => {
  // The demo has an archived delivery on each team board.
  await page.goto('/app?board=b-atlas&view=archive')
  await expect(page.getByText('Team Atlas archive')).toBeVisible()
  await expect(page.locator('tr', { hasText: 'Rate limit messaging' })).toBeVisible()
  await expect(page.locator('tr', { hasText: 'Export the register as CSV' })).toHaveCount(0)

  await page.goto('/app?board=b-nova&view=archive')
  await expect(page.getByText('Team Nova archive')).toBeVisible()
  await expect(page.locator('tr', { hasText: 'Export the register as CSV' })).toBeVisible()
  await expect(page.locator('tr', { hasText: 'Rate limit messaging' })).toHaveCount(0)
})

test('an archived initiative is read-only and raises no warnings', async ({ page }) => {
  await openBoard(page)
  await page.locator('[data-card-id="init-billing"]').first().click()
  const panel = page.locator('[data-item-panel]')
  await expect(panel.getByText(/^\d+ warnings?$/)).toBeVisible()

  // Discard it: it leaves play, and its warnings leave with it. Because it has cards below it,
  // the discard asks first and names the cascade.
  await panel.getByRole('button', { name: 'More', exact: true }).click()
  await panel.getByRole('button', { name: 'Discard', exact: true }).click()
  const confirm = page.locator('[data-confirm-dialog]')
  await expect(confirm).toBeVisible()
  await expect(confirm).toContainText('also files')
  await expect(confirm).toContainText('below it')
  await confirm.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(panel.getByText(/^\d+ warnings?$/)).toHaveCount(0)
  await expect(panel.getByLabel('Title')).toBeDisabled()
  await expect(panel.getByText(/read-only until you restore it/)).toBeVisible()

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

test('auto-archive has no setting anywhere: finished work is filed after a week', async ({ page }) => {
  await page.goto('/app?board=b-atlas&view=archive')
  await expect(page.getByText('Team Atlas archive')).toBeVisible()

  // The archive reads what has been filed, and the age is the product's constant — so neither this
  // page nor Board settings offers a number to change.
  await expect(page.getByLabel('Auto-archive Done after')).toHaveCount(0)
  await openBoard(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.locator('[data-board-settings]')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Auto-archive Done after')).toHaveCount(0)
})
