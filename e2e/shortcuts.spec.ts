import { expect, test } from '@playwright/test'
import { openBoard } from './support'

/**
 * The keyboard has a page of its own.
 *
 * `?` opens it from the board, the palette reaches it by name, and neither steals the character
 * from a field somebody is typing in. Escape closes it and gives the focus back — the same contract
 * every other dialog keeps.
 */
test('? opens the sheet, traps the keyboard and gives it back', async ({ page }) => {
  await openBoard(page)
  const card = page.locator('[data-card-id="st-signup-rebuild"]')
  await card.focus()

  await page.keyboard.press('Shift+Slash')
  const sheet = page.locator('[data-shortcuts-sheet]')
  await expect(sheet).toBeVisible()
  await expect(sheet).toContainText('Keyboard shortcuts')
  await expect(sheet).toContainText('Command palette')
  await expect(sheet).toContainText('Search every board')
  await expect(sheet).toContainText('Card drawer')
  await expect(sheet).toContainText('Ctrl+K on Windows and Linux')
  await expect(sheet.locator(':focus')).toHaveCount(1)

  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await expect(card).toBeFocused()
})

test('? in a field is a question mark, not a request for the sheet', async ({ page }) => {
  await openBoard(page)
  const search = page.getByPlaceholder('Search all boards…')
  await search.click()
  await search.press('?')
  await expect(search).toHaveValue('?')
  await expect(page.locator('[data-shortcuts-sheet]')).toHaveCount(0)
})

test('the palette opens the sheet by name', async ({ page }) => {
  await openBoard(page)
  await page.waitForLoadState('networkidle')
  await page.keyboard.press('Control+k')
  const query = page.getByLabel('Command palette query')
  await expect(query).toBeVisible()
  await query.fill('keyboard shortcuts')
  await expect(page.getByRole('button', { name: /Keyboard shortcuts/ })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-shortcuts-sheet]')).toBeVisible()
  await expect(page.getByLabel('Command palette query')).toHaveCount(0)
})
