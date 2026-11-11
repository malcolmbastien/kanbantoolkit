import { expect, test } from '@playwright/test'
import { openBoard } from './support'

/**
 * Multi-select is a card group, not a filter on the board.
 *
 * The cards outside the group stay as they are — they are the next thing a reader may shift-click,
 * not things the board has ruled out. And the assignee suggestion list belongs above the fixed bulk
 * bar, not below the bottom of the screen.
 */

test('a card group leaves the other cards selectable, and the assignee list opens upward', async ({ page }) => {
  await openBoard(page)
  const first = page.locator('[data-card-id="st-signup-rebuild"]')
  const second = page.locator('[data-card-id="st-signup-validation"]')

  await first.click({ modifiers: ['Shift'] })
  const bulk = page.locator('[data-bulk-actions]')
  await expect(bulk).toContainText('1 selected')
  // The card not in the group is still a normal, selectable card.
  await expect(second).not.toHaveClass(/opacity-40/)

  // An initiative is not a card and cannot join the group: it recedes, and pressing it neither
  // opens its drawer nor changes the selection.
  const initiative = page.locator('[data-workflow="initiatives"] [data-card-id="init-billing"]')
  await expect(initiative).toHaveClass(/opacity-40/)
  await initiative.click()
  await expect(page.locator('[data-item-panel]')).toHaveCount(0)
  await expect(bulk).toContainText('1 selected')

  await second.click({ modifiers: ['Shift'] })
  await expect(bulk).toContainText('2 selected')

  // The fixed bar sits at the bottom, so the people list must flip above its field rather than
  // continue off the viewport.
  const assign = page.getByRole('combobox', { name: 'Add a person to the selected cards' })
  await assign.click()
  const list = page.getByRole('listbox', { name: 'People in this workspace' })
  await expect(list).toBeVisible()
  const field = await assign.boundingBox()
  const menu = await list.boundingBox()
  expect(field).not.toBeNull()
  expect(menu).not.toBeNull()
  expect(menu!.y + menu!.height).toBeLessThanOrEqual(field!.y)
  expect(menu!.y).toBeGreaterThanOrEqual(0)
})
