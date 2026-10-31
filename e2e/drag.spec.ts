import { expect, test } from '@playwright/test'
import { cardsIn, dropAbove, dropAtEnd, dropBelow, lane, openBoard } from './support'

/**
 * The one gesture the board is built around. What is asserted is the *position*, not just the
 * lane: a drop that lands somewhere else is the difference between a board and a pile.
 */
test('a card dragged to another lane lands above the card it was dropped above', async ({ page }) => {
  await openBoard(page)
  const backlog = await cardsIn(page, 'Backlog')
  const target = await cardsIn(page, 'Not Started')
  const [moved] = backlog

  await dropAbove(page, moved, target[0])

  await expect.poll(() => cardsIn(page, 'Not Started')).toEqual([moved, ...target])
  await expect.poll(() => cardsIn(page, 'Backlog')).toEqual(backlog.slice(1))
})

test('a card dragged within its lane reorders, and the order survives a reload', async ({ page }) => {
  await openBoard(page)
  const order = await cardsIn(page, 'Not Started')
  const [first, second] = order

  // Below the second card is after it: the two trade places. Above it would be the first card's
  // own place — the lifted card has left the list, so "above the second" means "at the top".
  await dropBelow(page, first, second)
  await expect.poll(() => cardsIn(page, 'Not Started')).toEqual([second, first, ...order.slice(2)])

  await page.reload()
  await expect(lane(page, 'Not Started')).toBeVisible()
  expect(await cardsIn(page, 'Not Started')).toEqual([second, first, ...order.slice(2)])
})

test('a drop within its own lane keeps the arrival clock, so the age warning stays', async ({ page }) => {
  await openBoard(page)
  // A card the demo has held in Not Started long enough to carry the “Nd in lane” warning.
  const card = page.locator('[data-workflow="cards"] [data-card-id]').filter({ hasText: 'Migrate invoice numbering' })
  const badge = card.getByText(/\d+d in lane/)
  await expect(badge).toBeVisible()
  const before = (await badge.innerText()).trim()
  const id = (await card.getAttribute('data-card-id'))!

  // A drop at the end of the same lane is a position, not an arrival. The warning must survive it.
  await dropAtEnd(page, id, 'Not Started')
  await expect(page.locator(`[data-card-id="${id}"]`).getByText(/\d+d in lane/)).toHaveText(before)
})

test('a card dropped past the last card lands at the end of the lane', async ({ page }) => {
  await openBoard(page)
  const backlog = await cardsIn(page, 'Backlog')
  const done = await cardsIn(page, 'Done')
  const moved = backlog[backlog.length - 1]

  await dropAtEnd(page, moved, 'Done')

  await expect.poll(() => cardsIn(page, 'Done')).toEqual([...done, moved])
  await expect.poll(() => cardsIn(page, 'Backlog')).toEqual(backlog.slice(0, -1))
})
