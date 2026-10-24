import { expect, test } from '@playwright/test'
import { cardsIn, dragCardTo, lane, laneRegion, openBoard } from './support'

/**
 * The keyboard is a way to use the app, not a fallback.
 *
 * Three promises: a dialog keeps the keyboard while it is open and gives it back when it closes; a
 * change made with the keyboard is said out loud, so it is not silent; and everything a drag does
 * has a path that does not need a pointer — move to a lane, set a parent, reorder.
 */

test('a dialog keeps the keyboard, and gives it back', async ({ page }) => {
  await openBoard(page)
  const opener = page.getByRole('button', { name: 'Settings', exact: true })
  await opener.focus()
  await opener.press('Enter')

  const dialog = page.locator('[data-board-settings]')
  await expect(dialog).toBeVisible()
  // The caret starts inside the dialog.
  await expect(dialog.locator(':focus')).toHaveCount(1)

  // Tab, all the way round, more times than there are controls in it: focus never leaves.
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab')
    expect(await dialog.locator(':focus').count()).toBe(1)
  }
  // And backwards.
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Shift+Tab')
    expect(await dialog.locator(':focus').count()).toBe(1)
  }

  // Escape closes it and puts the caret back where it was.
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()
})

test('a card is moved to another lane with the keyboard alone, and it is announced', async ({ page }) => {
  await openBoard(page)
  const cards = await cardsIn(page, 'Backlog')
  const moving = cards[0]

  // Into the menu the way the keyboard does: Shift+F10 on a focused card.
  await page.locator(`[data-card-id="${moving}"]`).focus()
  await page.keyboard.press('Shift+F10')
  const menu = page.locator('[data-card-menu]').first()
  await expect(menu).toBeVisible()

  // "Move to lane" is a header with a flyout, and focus opens it — the same affordance the pointer
  // gets from hovering. The lanes are its items.
  await menu.getByRole('button', { name: 'Move to lane' }).focus()
  const flyout = page.locator('[data-card-flyout]')
  await expect(flyout).toBeVisible()

  const destination = flyout.getByRole('button', { name: /Not Started/ })
  await destination.focus()
  await page.keyboard.press('Enter')

  // The card is in the new cell, and the app said so rather than leaving it to be discovered.
  await expect(page.locator(`[data-workflow="cards"] [data-lane-id] [data-card-id="${moving}"]`)).toHaveCount(1)
  await expect(lane(page, 'Not Started').locator(`[data-card-id="${moving}"]`)).toBeVisible()
  await expect(page.locator('[data-announcer]')).toContainText(/moved to/i)
})

test('a card is reordered with the keyboard, and the position is announced', async ({ page }) => {
  await openBoard(page)
  const cards = await cardsIn(page, 'Not Started')
  const [first] = cards

  await page.locator(`[data-card-id="${first}"]`).focus()
  await page.keyboard.press('Shift+F10')
  const later = page.locator('[data-card-menu]').first().getByRole('button', { name: 'Move later' })
  await later.focus()
  await page.keyboard.press('Enter')

  const now = await cardsIn(page, 'Not Started')
  expect(now[0]).not.toBe(first)
  expect(now).toContain(first)
  await expect(page.locator('[data-announcer]')).toContainText(/is now \d+ of \d+/i)
})

test('a pointer drag is announced too, so the two ways in agree', async ({ page }) => {
  await openBoard(page)
  const [card] = await cardsIn(page, 'Backlog')
  const title = await page.locator(`[data-card-id="${card}"]`).getAttribute('data-card-title')

  const box = (await laneRegion(page, 'Done').boundingBox())!
  await dragCardTo(page, card, { x: box.x + box.width / 2, y: box.y + box.height - 10 })

  await expect(page.locator('[data-announcer]')).toContainText(/moved to/i)
  if (title) await expect(page.locator('[data-announcer]')).toContainText(title)
})
