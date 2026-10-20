import { expect, type Locator, type Page } from '@playwright/test'

/** Where every flow starts: the demo's first board, which the app seeds itself on a fresh origin. */
export const ATLAS = '/?board=b-atlas'

/** Open a board and wait for it to draw. A fresh context means an empty origin, so the demo seeds. */
export async function openBoard(page: Page, url = ATLAS): Promise<void> {
  await page.goto(url)
  await expect(lane(page, 'Backlog')).toBeVisible()
}

/**
 * One lane of the cards workflow, by the name its heading shows — the whole lane, which is its
 * heading, its cards and its footer. The workflow attribute is what makes this unambiguous: the
 * initiatives flow has lanes of the same names above it, and "the Backlog" means the team's own.
 */
export function laneRegion(page: Page, name: string): Locator {
  return page
    .locator('[data-workflow="cards"] div[role="region"]')
    .filter({ hasText: name })
    .last()
}

/** The cards of a lane — the part a card is dropped into. */
export function lane(page: Page, name: string): Locator {
  return laneRegion(page, name).locator('[data-lane-id]')
}

/** The cards in a lane, in the order the lane shows them. */
export async function cardsIn(page: Page, name: string): Promise<string[]> {
  return lane(page, name)
    .locator('[data-card-id]:not([data-card-initiative])')
    .evaluateAll((elements) => elements.map((el) => (el as HTMLElement).dataset.cardId ?? ''))
}

/**
 * The one way in for new work: the footer button of a lane.
 *
 * The button repeats — every column has one — so it is found by the name a screen reader hears,
 * which is the lane's own: "Add a card to Backlog".
 */
export async function addCardTo(page: Page, name: string): Promise<void> {
  await laneRegion(page, name).getByRole('button', { name: `Add a card to ${name}` }).click()
}
