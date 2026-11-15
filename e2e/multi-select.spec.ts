import { expect, test } from '@playwright/test'
import { cardsIn, lane, openBoard } from './support'

/**
 * Multi-select is a card group, not a filter on the board.
 *
 * The cards outside the group stay as they are — they are the next thing a reader may shift-click,
 * not things the board has ruled out. And the assignee suggestion list belongs above the fixed bulk
 * bar, not below the bottom of the screen.
 */

test('dragging one card moves the whole selection, and keeps the selection', async ({ page }) => {
  await openBoard(page)
  const first = page.locator('[data-card-id="st-signup-rebuild"]')
  const second = page.locator('[data-card-id="st-signup-validation"]')
  await first.click({ modifiers: ['Shift'] })
  await second.click({ modifiers: ['Shift'] })
  const bulk = page.locator('[data-bulk-actions]')
  await expect(bulk).toContainText('2 selected')

  await first.scrollIntoViewIfNeeded()
  const from = await first.boundingBox()
  const to = await lane(page, 'Done').boundingBox()
  if (!from || !to) throw new Error('The group drag has no box to travel between.')
  await page.mouse.move(from.x + from.width / 2, from.y + 18)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height - 10, { steps: 12 })

  // The graphic says a group is in the air, not one card.
  await expect(page.locator('[data-drag-layer]')).toHaveCount(1)
  await expect(page.locator('[data-drag-count]')).toHaveText('2')

  await page.mouse.up()

  // Both cards landed, in the order the group was carried: the grabbed card first.
  const done = await cardsIn(page, 'Done')
  expect(done).toContain('st-signup-rebuild')
  expect(done).toContain('st-signup-validation')
  expect(done.slice(-2)).toEqual(['st-signup-rebuild', 'st-signup-validation'])
  // The gesture moved cards, not opened one, and the selection is still there for the next verb.
  await expect(page.locator('[data-item-panel]')).toHaveCount(0)
  await expect(bulk).toContainText('2 selected')
})

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
