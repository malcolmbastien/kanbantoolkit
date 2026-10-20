import { expect, test, type Page } from '@playwright/test'
import { cardsIn, dropAbove, openBoard } from './support'

/**
 * The justify policy, and the case that once broke while every unit test passed: the drop wrote
 * its position regardless of the policy's answer, so cancelling the prompt left the card moved.
 */

/** Make the board ask for a reason before a move that would exceed a lane's limit. */
async function askForReasons(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.locator('#board-wip').selectOption('justify')
  await page.keyboard.press('Escape')
  await expect(page.locator('#board-wip')).toHaveCount(0)
}

const reasonDialog = (page: Page) => page.locator('[data-reason-dialog]')

test('cancelling the reason leaves the card exactly where it was', async ({ page }) => {
  await openBoard(page)
  await askForReasons(page)

  const backlog = await cardsIn(page, 'Backlog')
  const target = await cardsIn(page, 'Not Started')
  const moved = backlog[0]

  // Not Started holds more than its limit, so the drop asks before it lands.
  await dropAbove(page, moved, target[0])
  await expect(reasonDialog(page)).toBeVisible()

  await reasonDialog(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(reasonDialog(page)).toHaveCount(0)

  // Nothing moved: not the lane, and not the position.
  expect(await cardsIn(page, 'Backlog')).toEqual(backlog)
  expect(await cardsIn(page, 'Not Started')).toEqual(target)
})

test('a reason lands the card where it was dropped, and is recorded on it', async ({ page }) => {
  await openBoard(page)
  await askForReasons(page)

  const target = await cardsIn(page, 'Not Started')
  const [moved] = await cardsIn(page, 'Backlog')
  const reason = 'Signed off by the product owner for the pilot'

  await dropAbove(page, moved, target[0])
  await reasonDialog(page).getByRole('textbox').fill(reason)
  await reasonDialog(page).getByRole('button', { name: 'Move with reason' }).click()
  await expect(reasonDialog(page)).toHaveCount(0)

  // Where it was dropped: above the card it was dropped above.
  await expect.poll(() => cardsIn(page, 'Not Started')).toEqual([moved, ...target])

  // On the card's Activity...
  await page.locator(`[data-card-id="${moved}"]`).click()
  await page.getByRole('button', { name: 'Activity' }).click()
  await expect(page.getByText(reason)).toBeVisible()

  // ...and on the card itself, as the workspace holds it.
  const stored = await page.evaluate((id) => {
    const raw = window.localStorage.getItem('flowline-state-v3')
    if (!raw) return null
    const state = (JSON.parse(raw) as { state: { items: { id: string; lastMoveReason?: string }[] } }).state
    return state.items.find((item) => item.id === id)?.lastMoveReason ?? null
  }, moved)
  expect(stored).toBe(reason)
})
