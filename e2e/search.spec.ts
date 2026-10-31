import { expect, test } from '@playwright/test'
import { openBoard } from './support'

/**
 * Search is over all the words on a card, not only its title.
 *
 * The demo's "Rebuild the signup form" carries the word "Acceptance" only in its description, and
 * a note is the other place a person writes detail. Both are found here, and the result says which
 * line matched — a title-only answer that points at a card whose visible face says nothing about
 * the query is the bug this spec keeps out.
 */
test('search finds a description and shows the matching line', async ({ page }) => {
  await openBoard(page)
  await page.getByPlaceholder('Search all boards…').fill('Acceptance')

  const match = page.locator('[data-search-match]').first()
  await expect(match).toContainText('Description')
  await expect(match.locator('mark')).toHaveText(/acceptance/i)
  await expect(match).toContainText('works on a phone')

  // Choosing the result opens the card, not merely the board it sits on.
  await match.click()
  await expect(page.locator('[data-item-panel]')).toHaveAttribute('aria-label', 'Card details: Rebuild the signup form')
})

test('search finds a note and shows it as a note', async ({ page }) => {
  await openBoard(page)
  // A note is written the way a person writes one, so the search is over real workspace state.
  await page.locator('[data-card-id="st-signup-rebuild"]').click()
  const panel = page.locator('[data-item-panel]')
  await expect(panel).toBeVisible()
  await panel.getByLabel('Leave a note').fill('The checkout copy needs a second pair of eyes')
  await panel.getByLabel('Leave a note').press('Enter')
  await panel.getByRole('button', { name: 'Activity', exact: true }).click()
  await expect(panel).toContainText('The checkout copy needs a second pair of eyes')

  await page.getByPlaceholder('Search all boards…').fill('checkout copy')
  const match = page.locator('[data-search-match]').first()
  await expect(match).toContainText('Note')
  await expect(match.locator('mark')).toHaveText(/checkout copy/i)
  await match.click()
  await expect(page.locator('[data-item-panel]')).toHaveAttribute('aria-label', 'Card details: Rebuild the signup form')
})
