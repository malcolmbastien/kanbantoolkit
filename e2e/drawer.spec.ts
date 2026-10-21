import { expect, test, type Page } from '@playwright/test'
import { cardsIn, openBoard } from './support'

/**
 * The drawer's four edits, each asserted where it matters: **on the card**, after the drawer has
 * closed. A field that changes inside a panel and nowhere else is a field that did not change.
 */

/** Open the first card of the Backlog and answer its id. */
async function openFirstBacklogCard(page: Page): Promise<string> {
  const [id] = await cardsIn(page, 'Backlog')
  await page.locator(`[data-card-id="${id}"]`).click()
  await expect(page.getByLabel('Title')).toBeVisible()
  return id
}

const closeDrawer = (page: Page) => page.getByRole('button', { name: 'Close' }).click()
const card = (page: Page, id: string) => page.locator(`[data-card-id="${id}"]`)

test('a title edited in the drawer is the card’s title', async ({ page }) => {
  await openBoard(page)
  const id = await openFirstBacklogCard(page)

  await page.getByLabel('Title').fill('Renamed where a person renames it')
  await closeDrawer(page)

  await expect(card(page, id)).toContainText('Renamed where a person renames it')
})

test('a tag added in the drawer is on the card', async ({ page }) => {
  await openBoard(page)
  const id = await openFirstBacklogCard(page)

  const tags = page.getByLabel('Add a tag')
  await tags.fill('security')
  await tags.press('Enter')
  await closeDrawer(page)

  await expect(card(page, id)).toContainText('security')
})

test('a person added in the drawer is on the card', async ({ page }) => {
  await openBoard(page)
  const id = await openFirstBacklogCard(page)

  const people = page.getByPlaceholder('Add a name…')
  await people.fill('Maya Blake')
  await people.press('Enter')
  await closeDrawer(page)

  // The card wears initials rather than names, because a card is small.
  await expect(card(page, id)).toContainText('MB')
})

test('a pip on an initiative opens the child and brings it into view', async ({ page }) => {
  // The board is taller than this viewport, so the child card starts out of sight below it.
  await page.setViewportSize({ width: 1200, height: 700 })
  await openBoard(page)

  const initiative = page.locator('[data-card-initiative]').filter({ hasText: 'Signup redesign' }).first()
  await initiative.getByRole('button', { name: 'Rebuild the signup form — In Progress' }).click()

  await expect(page.locator('[data-item-panel]')).toHaveAttribute('aria-label', 'Card details: Rebuild the signup form')

  // The pip is a way in to a card in the other workflow: the drawer opens, and the board
  // moves to the card rather than leaving the reader to find it.
  const child = page.locator('[data-workflow="cards"] [data-card-id]').filter({ hasText: 'Rebuild the signup form' }).first()
  await expect.poll(async () => {
    const box = await child.boundingBox()
    const height = page.viewportSize()?.height ?? 0
    return Boolean(box && box.y >= 0 && box.y + box.height <= height)
  }).toBe(true)
})

test('a parent set in the drawer is the card’s lineage', async ({ page }) => {
  await openBoard(page)
  const id = await openFirstBacklogCard(page)

  await page.getByRole('button', { name: 'Change parent' }).click()
  // The parent editor is the last select in the panel; the only other one is the type.
  await page.locator('select').last().selectOption({ label: 'Trial experience' })
  await page.getByRole('button', { name: 'Set parent' }).click()
  await closeDrawer(page)

  await expect(card(page, id)).toContainText('Trial experience')
})
