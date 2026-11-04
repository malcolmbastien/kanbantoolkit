import { expect, test, type Page } from '@playwright/test'
import { cardsIn, openBoard } from './support'

/**
 * The palette's verbs, on the card in hand.
 *
 * The palette navigates by default; these tests ask it to act. Every verb goes through the same
 * store action the button uses, so the assertions are about the board afterwards — an assignee on
 * the card, a refusal in the board's own words — not about a toast that could say anything.
 */

/** The demo's identity, set the way a person sets it (the picker in My work). */
async function beMaya(page: Page): Promise<void> {
  await page.goto('/app?view=mywork')
  await page.getByLabel('Whose work to show').selectOption({ label: 'Maya Blake' })
  await page.getByRole('button', { name: 'Close My work' }).click()
}

async function palette(page: Page): Promise<void> {
  await page.keyboard.press('Control+k')
  await expect(page.getByLabel('Command palette query')).toBeVisible()
}

test('a card is assigned to me from the palette, and the chip is on the card', async ({ page }) => {
  await openBoard(page)
  await beMaya(page)

  const [id] = await cardsIn(page, 'Backlog')
  await page.locator(`[data-card-id="${id}"]`).click()
  await palette(page)
  await page.getByLabel('Command palette query').fill('assign to me')
  await page.keyboard.press('Enter')

  // The board's announcement surface says what happened, and the card carries the person.
  await expect(page.locator('[data-announcer]')).toContainText('assigned to you')
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.locator(`[data-card-id="${id}"] [title="Maya Blake"]`)).toBeVisible()
})

test('blocking from the palette asks for a reason, and the card carries it', async ({ page }) => {
  await openBoard(page)
  await page.locator('[data-card-id="st-pricing-experiment"]').click()
  await palette(page)
  await page.getByLabel('Command palette query').fill('block')
  await page.keyboard.press('Enter')

  // The palette's box becomes the question rather than opening a second dialog.
  const reason = page.getByLabel('Why is Split the pricing experiment framework blocked?')
  await expect(reason).toBeVisible()
  await reason.fill('Needs a pricing decision')
  await page.keyboard.press('Enter')

  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.locator('[data-card-id="st-pricing-experiment"]')).toContainText('Blocked')
  await expect(page.locator('[data-card-id="st-pricing-experiment"]')).toContainText('Needs a pricing decision')
})

test('a move into a full block column is refused with the board’s own words', async ({ page }) => {
  await openBoard(page)

  // Make Atlas refuse a full lane, and make its Done cell full. Written through the persisted
  // workspace because this is a board *setting*, not something a palette test should click through.
  const changed = await page.evaluate(() => {
    const key = 'kanbantoolkit-state-v3'
    const raw = localStorage.getItem(key)
    if (!raw) return false
    const parsed = JSON.parse(raw) as { state?: Record<string, unknown> } & Record<string, unknown>
    const state = (parsed.state ?? parsed) as {
      boards: Array<{ id: string; wipEnforcement?: string }>
      flows: Array<{ id: string; boardId: string; kind: string; order: number }>
      lanes: Array<{ id: string; boardId: string; flowId: string; name: string; wipLimit?: number }>
    }
    const board = state.boards.find((candidate) => candidate.id === 'b-atlas')
    const flow = state.flows.find(
      (candidate) => candidate.boardId === 'b-atlas' && candidate.kind === 'cards' && candidate.order === 0,
    )
    const done = state.lanes.find(
      (candidate) => candidate.boardId === 'b-atlas' && candidate.flowId === flow?.id && candidate.name === 'Done',
    )
    if (!board || !done) return false
    board.wipEnforcement = 'block'
    done.wipLimit = 1
    localStorage.setItem(key, JSON.stringify(parsed))
    return true
  })
  expect(changed).toBe(true)
  await page.goto('/app?board=b-atlas')
  await expect(page.locator('[data-workflow="cards"] [data-card-id]').first()).toBeVisible()

  const [id] = await cardsIn(page, 'Backlog')
  await page.locator(`[data-card-id="${id}"]`).click()
  await palette(page)
  await page.getByLabel('Command palette query').fill('move to done')
  await page.keyboard.press('Enter')

  // The move rule is the store's, and its sentence is the one a drag would have heard.
  await expect(page.locator('[data-announcer]')).toContainText('was not moved')
  await expect(page.locator('[data-announcer]')).toContainText('at its limit of 1')
  await expect(page.locator(`[data-card-id="${id}"]`)).toBeVisible()
})

test('nothing is offered that the board would refuse', async ({ page }) => {
  await openBoard(page)
  await beMaya(page)

  // Maya is already on this card, so "Assign to me" is not a verb it has.
  await page.locator('[data-card-id="st-signup-validation"]').click()
  await palette(page)
  await page.getByLabel('Command palette query').fill('assign')
  await expect(page.getByRole('button', { name: /^Assign to me/ })).toHaveCount(0)
  await page.keyboard.press('Escape')

  // An initiative's section is derived from its work, so it has no "move to Done".
  await page.locator('[data-card-id="init-signup-redesign"]').click()
  await palette(page)
  await page.getByLabel('Command palette query').fill('move to done')
  await expect(page.getByRole('button', { name: /^Move to Done/ })).toHaveCount(0)
})
