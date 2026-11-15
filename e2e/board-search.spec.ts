import { expect, test } from '@playwright/test'
import { openBoard } from './support'

/**
 * The board's Search view.
 *
 * The top bar is a jump; this is the review table. It searches the board's own live work, reuses
 * the board's filters, and opens a row in the drawer without taking the result set away. The query
 * is the place's own: back, forward and a shared link all restore the words.
 */

test('the board search reads the work, its metadata and the filters', async ({ page }) => {
  await openBoard(page)
  await page.getByRole('button', { name: 'Search', exact: true }).click()

  const view = page.locator('[data-board-search]')
  await expect(view).toBeVisible()
  await expect(page).toHaveURL(/view=search/)

  const input = page.locator('[data-board-search-input]')
  await input.fill('signup')

  const row = view.locator('[data-search-row="st-signup-rebuild"]')
  await expect(row).toBeVisible()
  await expect(row).toContainText('Rebuild the signup form')
  await expect(row).toContainText('User Story')
  await expect(row).toContainText('In Progress')
  await expect(row.locator('[aria-label="Priority: High"]')).toBeVisible()
  await expect(view.getByRole('status').first()).toContainText('result')
  await expect(view.getByRole('status').first()).toContainText('Sorted by Relevance')

  // The board's own filters narrow the same result set.
  await page.getByLabel('Filter by type').selectOption({ label: 'Bug' })
  await expect(view.locator('[data-search-row="st-signup-validation"]')).toBeVisible()
  await expect(view.locator('[data-search-row="st-signup-rebuild"]')).toHaveCount(0)

  // A stage narrows it too, and a filter that leaves nothing says so.
  await view.getByRole('group', { name: 'Stage' }).getByRole('button', { name: 'Done' }).click()
  await expect(view.locator('[data-search-empty]')).toContainText('No results for')
  await expect(view.locator('[data-search-empty]')).toContainText('Try clearing a filter')

  await view.getByRole('button', { name: 'Clear filters' }).click()
  await expect(view.locator('[data-search-row="st-signup-rebuild"]')).toBeVisible()

  // A person narrows it too, and the query is unchanged.
  await page.getByLabel('Filter by person').selectOption({ label: 'Riley Kim' })
  await expect(view.locator('[data-search-row="st-signup-rebuild"]')).toBeVisible()
  await expect(view.locator('[data-search-row="st-signup-validation"]')).toHaveCount(0)
  await view.getByRole('button', { name: 'Clear filters' }).click()
  await expect(view.locator('[data-search-row="st-signup-validation"]')).toBeVisible()

  // A row is a way in: the card opens beside the search, which stays where it was.
  await view.locator('[data-search-row="st-signup-rebuild"] [data-search-open]').click()
  await expect(page.locator('[data-item-panel]')).toBeVisible()
  await expect(page.getByLabel('Title')).toHaveValue('Rebuild the signup form')
  await expect(view).toBeVisible()
  expect(page.url()).toContain('view=search')
  expect(page.url()).toContain('q=signup')
})

test('the global finder hands its words to the board search, and history restores them', async ({ page }) => {
  await openBoard(page)
  const global = page.getByLabel('Search all boards')
  await global.fill('signup')

  const bridge = page.locator('[data-board-search-bridge]')
  await expect(bridge).toContainText('Search this board for “signup”')
  await bridge.click()

  const view = page.locator('[data-board-search]')
  await expect(view).toBeVisible()
  await expect(page.locator('[data-board-search-input]')).toHaveValue('signup')
  await expect(page).toHaveURL(/view=search.*q=signup/)

  // Back returns to the board, forward to the words.
  await page.goBack()
  await expect(view).toHaveCount(0)
  await expect(page.locator('[data-workflow="cards"]').first()).toBeVisible()
  await page.goForward()
  await expect(view).toBeVisible()
  await expect(page.locator('[data-board-search-input]')).toHaveValue('signup')
})

test('no query, no matches and archived work are all said honestly', async ({ page }) => {
  await page.goto('/app?board=b-atlas&view=search')
  const view = page.locator('[data-board-search]')
  await expect(view).toBeVisible()
  await expect(view).toContainText('Search this board’s live work')

  const input = page.locator('[data-board-search-input]')
  await input.fill('no-such-word-anywhere')
  await expect(view.locator('[data-search-empty]')).toContainText('No results for “no-such-word-anywhere”')

  // A delivered card filed in the Archive is still searchable there, not here.
  await input.fill('signup payload')
  await expect(view.locator('[data-search-empty]')).toContainText('No results for “signup payload”')
})

test('a thousand-card board stays responsive', async ({ page }) => {
  await page.goto('/app?stress=1000&view=search&q=e')
  const view = page.locator('[data-board-search]')
  await expect(view).toBeVisible()
  await expect(view.locator('[data-search-page]')).toContainText('Page 1 of')

  const input = page.locator('[data-board-search-input]')
  const started = Date.now()
  await input.fill('the')
  await expect(view.locator('[data-search-page]')).toContainText('Page 1 of')
  expect(Date.now() - started).toBeLessThan(4_000)
})
