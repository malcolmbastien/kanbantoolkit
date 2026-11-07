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

test('a wide card leaving a column does not change the column widths mid-drag', async ({ page }) => {
  await openBoard(page)
  const flow = page.locator('[data-flow-band]').first().locator('[data-workflow="cards"]')
  // Every column of the flow, at every depth: the Dev cell that holds this card is nested inside
  // the In Progress column, and it is the one that shrinks when the card leaves.
  const columns = flow.locator('[data-lane-col]')
  const widths = () =>
    columns.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width))
  const before = await widths()

  // The Dev column is wider than its neighbours because this card is its widest content.
  const card = page.locator('[data-card-id="st-enterprise-sso"]')
  const target = lane(page, 'Backlog')
  const cardBox = (await card.boundingBox())!
  const targetBox = (await target.boundingBox())!
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + 18)
  await page.mouse.down()
  await page.mouse.move(cardBox.x + cardBox.width / 2 + 20, cardBox.y + 24, { steps: 5 })
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 10, { steps: 12 })

  await expect(page.locator('[data-drag-layer]')).toHaveCount(1)
  const during = await widths()
  expect(during).toHaveLength(before.length)
  during.forEach((width, i) => expect(width).toBeCloseTo(before[i], 0))

  // The gesture still does what it says: the card lands where it was aimed.
  await page.mouse.up()
  await expect.poll(() => cardsIn(page, 'Backlog')).toContain('st-enterprise-sso')
})

test('a workflow holds its starting height while a card is in the air', async ({ page }) => {
  await openBoard(page)
  const flow = page.locator('[data-flow-band]').first().locator('[data-workflow="cards"]')
  const grid = flow.locator('[data-lane-grid]')
  const before = (await flow.boundingBox())!.height
  const gridBefore = (await grid.boundingBox())!.height
  const laneBefore = (await lane(page, 'Done').boundingBox())!.height
  const card = page.locator('[data-card-id="st-signup-rebuild"]')
  const target = lane(page, 'Done')
  const cardBox = (await card.boundingBox())!
  const targetBox = (await target.boundingBox())!

  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + 18)
  await page.mouse.down()
  await page.mouse.move(cardBox.x + cardBox.width / 2 + 20, cardBox.y + 24, { steps: 5 })
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 10, { steps: 12 })

  await expect(page.locator('[data-drag-layer]')).toHaveCount(1)
  // The row of columns is pinned, so the tallest column — and the lane in it — keeps the shape
  // the drop is aimed at. Only the outer workflow can be measured afterwards.
  const minHeight = await grid.evaluate((el) => (el as HTMLElement).style.minHeight)
  expect(Number.parseFloat(minHeight)).toBeCloseTo(gridBefore, 0)
  expect((await flow.boundingBox())!.height).toBeGreaterThanOrEqual(before - 1)
  expect((await lane(page, 'Done').boundingBox())!.height).toBeCloseTo(laneBefore, 0)

  await page.mouse.up()
  await expect.poll(() => grid.evaluate((el) => (el as HTMLElement).style.minHeight)).toBe('')
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
