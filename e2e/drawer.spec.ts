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
