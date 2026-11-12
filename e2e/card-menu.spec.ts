import { expect, test } from '@playwright/test'
import { openBoard } from './support'

/**
 * A flyout belongs beside the row that opened it.
 *
 * It used to be placed as if every submenu needed most of the screen, so on a card near the
 * bottom a short date field jumped to the top of the menu and a priority list opened far above its
 * row. The flyout is now measured after it renders: it stays with the row when its content fits,
 * lifts only as far as it must when it does not, and scrolls only when the viewport itself is too
 * short to hold it.
 */
test('the target-start picker stays with its row', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 500 })
  await openBoard(page)

  await page.locator('[data-card-id="st-usage-billing"]').click({ button: 'right' })
  const menu = page.locator('[data-card-menu][role="menu"]').first()
  const row = menu.getByRole('button', { name: 'Target start' })
  await expect(row).toBeVisible()
  await row.hover()

  const flyout = page.locator('[data-card-flyout]')
  await expect(flyout).toBeVisible()
  const rowBox = await row.boundingBox()
  const flyoutBox = await flyout.boundingBox()
  expect(rowBox).not.toBeNull()
  expect(flyoutBox).not.toBeNull()
  // The flyout opens at the row, not at a height guessed from a long menu's needs.
  expect(Math.abs(flyoutBox!.y - rowBox!.y)).toBeLessThanOrEqual(8)
  // A field shorter than the viewport has nothing to scroll, so no scrollbar.
  expect(await flyout.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(false)
})

test('a long flyout on a card at the bottom stays by its row and inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 500 })
  await openBoard(page)

  await page.locator('[data-card-id="st-usage-billing"]').click({ button: 'right' })
  const menu = page.locator('[data-card-menu][role="menu"]').first()
  const row = menu.getByRole('button', { name: 'Priority' })
  await expect(row).toBeVisible()
  await row.hover()

  const flyout = page.locator('[data-card-flyout]')
  await expect(flyout).toBeVisible()
  const rowBox = await row.boundingBox()
  const flyoutBox = await flyout.boundingBox()
  expect(rowBox).not.toBeNull()
  expect(flyoutBox).not.toBeNull()

  // It lifts only enough to fit, rather than jumping to the top of the screen.
  expect(Math.abs(flyoutBox!.y - rowBox!.y)).toBeLessThanOrEqual(40)
  // And no part of it is left off the bottom of the viewport.
  expect(flyoutBox!.y).toBeGreaterThanOrEqual(0)
  expect(flyoutBox!.y + flyoutBox!.height).toBeLessThanOrEqual(500)
  // Its height is its content plus its border, so it ends without a scrollbar of its own edge.
  expect(await flyout.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(false)
})
