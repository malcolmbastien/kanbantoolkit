import { expect, test, type Page } from '@playwright/test'
import { addCardTo, laneRegion, openInstanceBoard, signInOnInstance } from './support'

/**
 * A card's history, read where it is read (task 192).
 *
 * The workspace document carries cards, not what happened to them. This spec proves that from the
 * outside: one browser makes a board, a comment and a move; a second browser — with no local history
 * at all — signs in and still finds the comment in Comments, in search and in My work, and the move in
 * the flow reading. If any view were still reading the loaded cards, the second browser would show
 * nothing.
 */

const ORIGIN = 'http://localhost:4182'
const ADA = { email: 'ada.lovelace@example.com', name: 'Ada Lovelace' }
const BOARD = 'Team Atlas'
const NOTE = 'The retries need a budget'

test.setTimeout(120_000)

async function openBoard(page: Page): Promise<void> {
  await signInOnInstance(page, ORIGIN, ADA)
  await page.goto(`${ORIGIN}/app?view=boards`)
  await page.getByRole('button', { name: BOARD, exact: true }).click()
  await expect(page.locator('[data-workflow="cards"]')).toBeVisible({ timeout: 20_000 })
}

test('a browser that never held the history still reads it', async ({ browser }) => {
  // ---- One browser makes the work: a card, a note that mentions its author, and a move. ----
  const author = await browser.newContext()
  const writer = await author.newPage()
  await openInstanceBoard(writer, ORIGIN, BOARD, ADA)
  await addCardTo(writer, 'Backlog')

  const card = writer.locator('[data-workflow="cards"] [data-card-id]').first()
  await expect(card).toBeVisible()
  const cardId = (await card.getAttribute('data-card-id')) ?? ''
  expect(cardId).not.toBe('')

  await card.click()
  const panel = writer.locator('[data-item-panel]')
  await panel.getByRole('button', { name: 'Comments', exact: true }).click()
  const composer = panel.getByLabel('Write a comment')
  await composer.fill('@Ad')
  const picker = panel.locator('[data-mention-picker]')
  await expect(picker).toBeVisible()
  await picker.getByRole('option', { name: /Ada Lovelace/ }).click()
  // The composer puts the caret after the chosen name on the next frame; typing before it lands
  // writes into the wrong place.
  await expect(composer).toHaveValue(/@Ada Lovelace /)
  await composer.pressSequentially(`${NOTE} for next quarter`)
  await composer.press('Enter')
  await expect(panel).toContainText(NOTE)

  // The note reaches the instance before the next write is based on a revision. A move sent while
  // the note's own save is still in flight would be based on a revision the server has passed.
  const logKinds = async () => {
    const page = (await (await writer.request.get(`${ORIGIN}/api/workspace/items/${cardId}/log`)).json()) as {
      entries: Array<{ kind: string }>
    }
    return page.entries.map((entry) => entry.kind)
  }
  await expect.poll(logKinds).toEqual(expect.arrayContaining(['noted']))

  // The card moves to Done, so there is a move the flow reading can rebuild. The menu is the same
  // move a drag makes, without a pointer that has to find a column first.
  await panel.getByTitle('Close').click()
  await writer.locator(`[data-workflow="cards"] [data-card-id="${cardId}"]`).focus()
  await writer.keyboard.press('Shift+F10')
  const menu = writer.locator('[data-card-menu]').first()
  await expect(menu).toBeVisible()
  await menu.getByRole('button', { name: 'Move to lane' }).focus()
  const flyout = writer.locator('[data-card-flyout]')
  await expect(flyout).toBeVisible()
  await flyout.getByRole('button', { name: 'Done', exact: true }).focus()
  await writer.keyboard.press('Enter')
  await expect(laneRegion(writer, 'Done').locator(`[data-card-id="${cardId}"]`)).toBeVisible()

  // Both writes reached the instance before the second browser asks.
  await expect.poll(logKinds).toEqual(expect.arrayContaining(['noted', 'moved']))

  // ---- A second browser, with nothing of its own, signs in and reads the same card. ----
  const reader = await browser.newContext()
  const page = await reader.newPage()
  await openBoard(page)
  await page.locator('[data-workflow="cards"] [data-card-id]').first().click()
  const drawer = page.locator('[data-item-panel]')

  await drawer.getByRole('button', { name: 'Comments', exact: true }).click()
  await expect(drawer.locator('[data-comments-loading]')).toHaveCount(0)
  await expect(drawer).toContainText(NOTE)
  await expect(drawer.locator('[data-comment-entry]')).toContainText('Ada Lovelace')
  await expect(drawer.locator('[data-mention-chip]')).toContainText('Ada Lovelace')

  // Search finds the note, though the card this browser loaded carries no history.
  await drawer.getByTitle('Close').click()
  await page.getByPlaceholder('Search all boards…').fill(NOTE)
  await expect(page.locator('[data-search-match]').filter({ hasText: NOTE })).toBeVisible()
  // The result list is a layer of its own; Escape closes it before the account menu is asked for.
  await page.keyboard.press('Escape')

  // My work lists the mention.
  await page.locator('button[title*="ada.lovelace@example.com"]').click()
  await page.getByRole('button', { name: 'My work' }).click()
  const myWork = page.locator('[data-my-work]')
  await expect(myWork.locator('[data-my-work-mentions]')).toBeVisible()
  await expect(myWork.locator('[data-my-work-mentions]')).toContainText(NOTE)

  // And the flow reading rebuilds the move this browser never held.
  await myWork.getByRole('button', { name: 'Close My work' }).click()
  await page.getByRole('button', { name: 'Flow', exact: true }).click()
  const flow = page.locator('[data-flow-view]')
  await expect(flow).toBeVisible()
  // The browser never held the move; the reading did not fall back to "no moves recorded".
  const history = flow.locator('[data-flow-history]')
  await expect(history).not.toContainText('No moves recorded yet')
  await expect(history).toContainText(/[1-9]\d* of \d+ cards have move history/, { timeout: 20_000 })
})
