import { expect, test, type Page } from '@playwright/test'
import { cardsIn, dropAtEnd, lane, laneRegion, openBoard } from './support'

/**
 * Board design: the work is done in edit mode, and the draft only becomes the board on Save. So
 * each test saves before it asserts — the claim is about the board, not about the draft.
 */

const editBoard = (page: Page) => page.getByRole('button', { name: 'Edit board' }).click()
const saveBoard = (page: Page) => page.getByRole('button', { name: 'Save' }).click()
const splitIntoColumns = (page: Page, name: string) =>
  laneRegion(page, name).getByRole('button', { name: 'Split this cell into columns' }).click()
/**
 * The Add control belongs to the *container*, and only a leaf cell is a named region — so this is
 * found by its own title, and takes the first one, which is the Backlog split.
 */
const addColumn = (page: Page) =>
  page.getByRole('button', { name: 'Add a column to this split' }).first().click()

test('splitting a cell gives it the columns it promised, and the cards move into the first', async ({ page }) => {
  await openBoard(page)
  const cards = await cardsIn(page, 'Backlog')

  await editBoard(page)
  await splitIntoColumns(page, 'Backlog')
  await saveBoard(page)

  // The cell is now a container of two, and its cards are in the first of them.
  await expect(page.locator('[data-workflow="cards"] [data-lane-id]')).toHaveCount(6)
  expect(await cardsIn(page, 'Column 1')).toEqual(cards)
})

test('a cell added to a split accepts a card', async ({ page }) => {
  await openBoard(page)
  const [moved] = await cardsIn(page, 'Backlog')

  await editBoard(page)
  await splitIntoColumns(page, 'Backlog')
  await addColumn(page)
  await saveBoard(page)

  // Column 3 is a real cell: a card dropped into it stays.
  await expect(lane(page, 'Column 3')).toBeVisible()
  await dropAtEnd(page, moved, 'Column 3')
  await expect.poll(() => cardsIn(page, 'Column 3')).toEqual([moved])
})

test('removing a cell leaves the cards it held somewhere valid', async ({ page }) => {
  await openBoard(page)
  const [moved] = await cardsIn(page, 'Backlog')

  await editBoard(page)
  await splitIntoColumns(page, 'Backlog')
  await addColumn(page)
  await saveBoard(page)
  await dropAtEnd(page, moved, 'Column 3')
  await expect.poll(() => cardsIn(page, 'Column 3')).toEqual([moved])

  await editBoard(page)
  await laneRegion(page, 'Column 3')
    .getByRole('button', { name: /Lane settings/ })
    .click()
  await page.getByRole('button', { name: 'Remove lane' }).click()
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Remove lane' }).click()
  await saveBoard(page)

  await expect(lane(page, 'Column 3')).toHaveCount(0)
  // The store's rule: a removed cell's cards go to the first surviving cell beside it.
  expect(await cardsIn(page, 'Column 1')).toContain(moved)
})

test('the design controls are not on the working board', async ({ page }) => {
  await openBoard(page)
  const split = page.getByRole('button', { name: 'Split this cell into columns' })

  await expect(split).toHaveCount(0)
  await editBoard(page)
  expect(await split.count()).toBeGreaterThan(0)
  await saveBoard(page)
  await expect(split).toHaveCount(0)
})
