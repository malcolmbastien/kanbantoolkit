import { expect, test, type Page } from '@playwright/test'
import { cardsIn, dropAbove, laneRegion, openBoard } from './support'

/**
 * The justify policy, and the case that once broke while every unit test passed: the drop wrote
 * its position regardless of the policy's answer, so cancelling the prompt left the card moved.
 */

/** Make the board ask for a reason before a move that would exceed a lane's limit. */
async function askForReasons(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click()
  const settings = page.locator('[data-board-settings]')
  // Board settings opens on General, where the WIP policy sits beside the board's identity.
  await page.locator('#board-wip').selectOption('justify')
  await page.keyboard.press('Escape')
  await expect(settings).toHaveCount(0)
}

const reasonDialog = (page: Page) => page.locator('[data-reason-dialog]')

test('a full column wears the alarm colour, not only a badge', async ({ page }) => {
  await openBoard(page)
  const cards = page.locator('[data-workflow="cards"]')
  const cell = (name: string) =>
    cards.locator('[data-lane-cell]').filter({ has: page.getByText(name, { exact: true }) }).first()

  // Not Started holds two cards against a limit of one. The breach is on the column in a pattern
  // the board uses nowhere else — hazard tape and the words — not a tint another stage could be
  // mistaken for. The cards stay white, which keeps a busy column reading as a column.
  const over = cell('Not Started')
  await expect(over).toHaveClass(/border-rose-400/)
  await expect(over.locator('[data-wip-stripe="over"]')).toHaveCount(1)
  expect(
    await over.locator('[data-wip-stripe]').evaluate((el) => getComputedStyle(el).backgroundImage),
    'the tape is a repeating pattern, not a flat colour',
  ).toContain('repeating-linear-gradient')
  await expect(over.locator('[data-wip-label="over"]')).toHaveText('Over WIP limit')

  // A column with no limit is untouched.
  await expect(cell('In Progress')).not.toHaveClass(/border-(rose|amber)-(400|500)/)

  // Bring Backlog to its own count, and it reads amber: at a limit is a watch, not a risk.
  await page.getByRole('button', { name: 'Edit board' }).click()
  await laneRegion(page, 'Backlog')
    .getByRole('button', { name: 'Name, WIP limit and policy' })
    .click()
  await page.locator('#lane-wip').fill('3')
  await page.locator('#lane-wip').press('Enter')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Save' }).click()

  const at = cell('Backlog')
  await expect(at).toHaveClass(/border-amber-400/)
  await expect(at.locator('[data-wip-label="at"]')).toHaveText('At WIP limit')

  // A folded column keeps the alarm colour on its strip: red for over, amber for at.
  await over.getByTitle('Collapse column').click()
  const strip = page
    .locator('[data-workflow="cards"] [role="treeitem"][aria-expanded="false"]')
    .filter({ hasText: 'Not Started' })
    .first()
  const edge = await strip.evaluate((el) => getComputedStyle(el).borderTopColor)
  expect(edge).toBe('rgb(225, 29, 72)')
})

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

  // On the card's History...
  await page.locator(`[data-card-id="${moved}"]`).click()
  await page.getByRole('button', { name: 'History' }).click()
  await expect(page.getByText(reason)).toBeVisible()

  // ...and on the card itself, as the workspace holds it.
  const stored = await page.evaluate((id) => {
    const raw = window.localStorage.getItem('kanbantoolkit-state-v3')
    if (!raw) return null
    const state = (JSON.parse(raw) as { state: { items: { id: string; lastMoveReason?: string }[] } }).state
    return state.items.find((item) => item.id === id)?.lastMoveReason ?? null
  }, moved)
  expect(stored).toBe(reason)
})
