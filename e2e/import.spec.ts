import { expect, test } from '@playwright/test'

/**
 * A board arrives from another tool, through the dialog and into the store.
 *
 * The file is a small Trello export; the mapping step keeps its default reading of the lists, and
 * the one thing the test cares about is that the cards are on the board afterwards, not in a
 * preview that was never written.
 */
const board = {
  name: 'Old Delivery Board',
  lists: [
    { id: 'l-todo', name: 'To Do' },
    { id: 'l-doing', name: 'Doing' },
    { id: 'l-done', name: 'Done' },
  ],
  members: [{ id: 'm-riley', fullName: 'Riley Kim' }],
  cards: [
    { id: 'c-1', name: 'First imported card', desc: 'The body of an imported card.', idList: 'l-todo', labels: [{ name: 'imported' }], idMembers: ['m-riley'] },
    { id: 'c-2', name: 'Second imported card', idList: 'l-doing' },
    { id: 'c-3', name: 'Already done elsewhere', idList: 'l-done', dateLastActivity: '2026-09-01T10:00:00Z' },
  ],
}

test('a Trello board is imported as one board and opens with its cards', async ({ page }) => {
  await page.goto('/app?view=boards')
  await page.getByRole('button', { name: /Import board/ }).click()
  const dialog = page.locator('[data-import-board-dialog]')
  await expect(dialog).toBeVisible()

  await dialog.getByLabel('Import file').setInputFiles({
    name: 'board.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(board)),
  })
  await expect(dialog.getByLabel('Imported board name')).toHaveValue('Old Delivery Board')
  await expect(dialog.locator('[data-import-preview]')).toContainText('3 cards')
  await dialog.getByLabel('Imported board name').fill('Imported Delivery')

  await dialog.getByRole('button', { name: 'Import board' }).click()
  await expect(page.locator('[data-workflow="cards"]')).toBeVisible()
  await expect(page.getByRole('button', { name: /Imported Delivery/ })).toBeVisible()
  await expect(page.locator('[data-card-id]').filter({ hasText: 'First imported card' })).toBeVisible()
  await expect(page.locator('[data-card-id]').filter({ hasText: 'Second imported card' })).toBeVisible()
  // The done card's stage is the source list's done, and its imported tag is on the card.
  await expect(page.locator('[data-card-id]').filter({ hasText: 'Already done elsewhere' })).toBeVisible()
  await expect(page.getByText('imported', { exact: true })).toBeVisible()
})
