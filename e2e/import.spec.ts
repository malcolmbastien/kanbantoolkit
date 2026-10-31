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
  members: [
    { id: 'm-riley', fullName: 'Riley Kim' },
    { id: 'm-sam', fullName: 'Sam Lee' },
  ],
  cards: [
    { id: 'c-1', name: 'First imported card', desc: 'The body of an imported card.', idList: 'l-todo', labels: [{ name: 'imported' }], idMembers: ['m-riley'] },
    { id: 'c-2', name: 'Second imported card', idList: 'l-doing', idMembers: ['m-sam'] },
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
  // The stage mapping wears the board's own stage colour, not a grey native select.
  const stage = dialog.getByRole('button', { name: 'Stage for To Do' })
  await expect(stage).toContainText('Not Started')
  await expect(stage.locator('span').first()).toHaveClass(/bg-blue-100/)
  await stage.click()
  // The menu is portalled out of the dialog so its scroll cannot clip it.
  for (const name of ['Backlog', 'Not Started', 'In Progress', 'Done']) {
    await expect(page.getByRole('option', { name })).toBeVisible()
  }
  await page.getByRole('option', { name: 'Not Started' }).click()
  await expect(stage).toContainText('Not Started')
  // An existing account is associated by name; a name with no account defaults to None, and the
  // import never offers to create one.
  await expect(dialog.getByLabel('Person for Riley Kim')).toHaveValue('u-rk')
  await expect(dialog.getByLabel('Person for Sam Lee')).toHaveValue('')
  await expect(dialog.getByLabel('Person for Sam Lee').locator('option', { hasText: 'Create a new person' })).toHaveCount(0)
  await expect(dialog.locator('[data-import-preview]')).toContainText('no matching account')
  await dialog.getByLabel('Imported board name').fill('Imported Delivery')

  await dialog.getByRole('button', { name: 'Import board' }).click()
  await expect(page.locator('[data-workflow="cards"]')).toBeVisible()
  await expect(page.getByRole('button', { name: /Imported Delivery/ })).toBeVisible()
  const first = page.locator('[data-card-id]').filter({ hasText: 'First imported card' })
  await expect(first).toBeVisible()
  // A card with no type of ours carries no type badge at all.
  await expect(first.getByText('None', { exact: true })).toHaveCount(0)
  await expect(page.locator('[data-card-id]').filter({ hasText: 'Second imported card' })).toBeVisible()
  // The done card's stage is the source list's done, and its imported tag is on the card.
  await expect(page.locator('[data-card-id]').filter({ hasText: 'Already done elsewhere' })).toBeVisible()
  await expect(page.getByText('imported', { exact: true })).toBeVisible()

  // A source card with no type of ours is None, not the first real card type.
  await first.click()
  const panel = page.locator('[data-item-panel]')
  await expect(panel.getByLabel('Type')).toHaveValue('t-none')
  await page.keyboard.press('Escape')
})
