import { expect, test } from '@playwright/test'
import { openBoard } from './support'

/**
 * A board's own activity stream.
 *
 * It is one reading of what happened to the board — cards made, changed and deleted, and the
 * board's own design — and it is not a second copy of a card's History. A deleted card leaves an
 * event with no card in it, and a card still on the board is a link into its drawer.
 */

test('the activity drawer reads the board stream, with day groups and anonymous deletions', async ({ page }) => {
  await openBoard(page)
  await page.getByRole('button', { name: 'Activity', exact: true }).click()

  const panel = page.locator('[data-board-activity]')
  await expect(panel).toBeVisible()
  await expect(panel).toHaveAttribute('aria-label', 'Board activity: Team Atlas')
  await expect(panel.getByRole('heading', { name: 'Board activity' })).toBeVisible()

  // The seeded stream is one reading of the board: a creation, a change, a design change and a
  // deletion, grouped under the day they happened.
  await expect(panel.locator('[data-board-activity-row="card.created"]')).toHaveCount(1)
  await expect(panel.locator('[data-board-activity-row="card.updated"]')).toHaveCount(1)
  await expect(panel.locator('[data-board-activity-row="board.updated"]')).toHaveCount(1)
  const deleted = panel.locator('[data-board-activity-row="card.deleted"]')
  await expect(deleted).toHaveCount(1)
  await expect(panel.getByRole('heading', { name: 'Today' })).toBeVisible()

  // The design change is a board-level sentence, with no card attached.
  await expect(panel).toContainText('added the lane Dev to In Progress')

  // The deletion names the act and nothing about the card: no title, no link, no snapshot.
  await expect(deleted).toContainText('deleted a card')
  await expect(deleted.getByRole('button')).toHaveCount(0)
  await expect(deleted).not.toContainText(/Rebuild|billing|signup/i)

  // An active card is a way into its drawer.
  const updated = panel.locator('[data-board-activity-row="card.updated"]')
  await expect(updated.getByRole('button', { name: 'Rebuild the signup form' })).toBeVisible()
})

test('opening a card from Activity replaces the drawer with that card', async ({ page }) => {
  await openBoard(page)
  await page.getByRole('button', { name: 'Activity', exact: true }).click()
  const panel = page.locator('[data-board-activity]')
  await expect(panel).toBeVisible()

  await panel.getByRole('button', { name: 'Rebuild the signup form' }).click()

  const card = page.locator('[data-item-panel]')
  await expect(card).toBeVisible()
  await expect(card.getByLabel('Title')).toHaveValue('Rebuild the signup form')
  await expect(page.locator('[data-board-activity]')).toHaveCount(0)
})

test('one side panel at a time: Activity and a card replace one another', async ({ page }) => {
  await openBoard(page)
  await page.locator('[data-workflow="cards"] [data-card-id]').first().click()
  await expect(page.locator('[data-item-panel]')).toBeVisible()
  const cardWidth = (await page.locator('[data-item-panel]').boundingBox())?.width

  await page.getByRole('button', { name: 'Activity', exact: true }).click()
  await expect(page.locator('[data-board-activity]')).toBeVisible()
  await expect(page.locator('[data-item-panel]')).toHaveCount(0)

  // It replaces the card in the same column, at the same width, the way Filters does.
  expect((await page.locator('[data-board-activity]').boundingBox())?.width).toBe(cardWidth)
  await page.getByTitle('Close board activity').click()
  await expect(page.locator('[data-board-activity]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Activity', exact: true })).toHaveAttribute('aria-pressed', 'false')

  await page.getByRole('button', { name: 'Activity', exact: true }).click()
  expect((await page.locator('[data-board-activity]').boundingBox())?.width).toBe(cardWidth)
  await page.getByTitle('Close board activity').click()
})

test('a card that has left the board is named but is not a link', async ({ page }) => {
  await openBoard(page)
  // Filing the card away is how it stops being an active card on this board.
  await page.locator('[data-card-id="st-signup-rebuild"]').click({ button: 'right' })
  const menu = page.locator('[data-card-menu][role="menu"]').first()
  await menu.getByRole('button', { name: /Discard|Archive/ }).click()
  await page.locator('[data-confirm-dialog]').getByRole('button', { name: /Discard|Archive/, exact: true }).last().click()
  await expect(page.locator('[data-card-id="st-signup-rebuild"]')).toHaveCount(0)

  await page.getByRole('button', { name: 'Activity', exact: true }).click()
  const updated = page.locator('[data-board-activity-row="card.updated"]')
  await expect(updated.first()).toContainText('Rebuild the signup form')
  // The title is still there for a reader, but there is nothing to open: the card has left.
  await expect(updated.getByRole('button')).toHaveCount(0)
})

test('a board with no stream says so instead of inventing one', async ({ page }) => {
  await openBoard(page, '/app?board=b-nova')
  await page.getByRole('button', { name: 'Activity', exact: true }).click()

  const empty = page.locator('[data-board-activity-empty]')
  await expect(empty).toBeVisible()
  await expect(empty).toContainText('No board activity yet')
  await expect(empty).toContainText("each card's History")
})
