import { expect, type Locator, type Page } from '@playwright/test'

/** Where every flow starts: the demo's first board, which the app seeds itself on a fresh origin. */
export const ATLAS = '/app?board=b-atlas'

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
  // A cell, by the attribute that marks one. The lanes are a tree — nested items share their
  // ancestors' names — so the role alone cannot say which of them is a cell; the deepest match,
  // by this attribute, is the one the cards belong to.
  return page
    .locator('[data-workflow="cards"] [data-lane-cell]')
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
 * which is the lane's own: "Add card to Backlog".
 */
export async function addCardTo(page: Page, name: string): Promise<void> {
  await laneRegion(page, name).getByRole('button', { name: `Add card to ${name}` }).click()
}

/** A locator's visible box, for a pointer to aim at. */
async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox()
  if (!box) throw new Error('There is nothing to drag: the element has no box.')
  return box
}

/**
 * Drag a card to a point the way a person does: press, move in steps, release.
 *
 * The app's lift is pointer-driven and starts after a few pixels, so a press that never moves is a
 * click, and a single jump is not a gesture. `steps` is what makes the pointer travel.
 */
export async function dragCardTo(page: Page, cardId: string, to: { x: number; y: number }): Promise<void> {
  const box = await boxOf(page.locator(`[data-card-id="${cardId}"]`))
  const from = { x: box.x + box.width / 2, y: box.y + 18 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.mouse.up()
}

/** Drop a card just above another: above its middle, which is where the lane reads "before it". */
export async function dropAbove(page: Page, cardId: string, targetId: string): Promise<void> {
  const target = await boxOf(page.locator(`[data-card-id="${targetId}"]`))
  await dragCardTo(page, cardId, { x: target.x + target.width / 2, y: target.y + 6 })
}

/** Drop a card just below another: past its middle, which is where the lane reads "after it". */
export async function dropBelow(page: Page, cardId: string, targetId: string): Promise<void> {
  const target = await boxOf(page.locator(`[data-card-id="${targetId}"]`))
  await dragCardTo(page, cardId, { x: target.x + target.width / 2, y: target.y + target.height - 6 })
}

/** Drop a card at the foot of a lane, past its last card. */
export async function dropAtEnd(page: Page, cardId: string, laneName: string): Promise<void> {
  const box = await boxOf(lane(page, laneName))
  await dragCardTo(page, cardId, { x: box.x + box.width / 2, y: box.y + box.height - 10 })
}

/**
 * The instance's front door.
 *
 * A deployment with a way in shows the sign-in screen before it shows a board — there is no account
 * menu to open, because there is nothing behind it yet. The development door is the one these specs
 * use: an address, and the person is made (or met) by the instance.
 */
export async function signInOnInstance(
  page: Page,
  origin: string,
  who: { email: string; name: string } = { email: 'maya.blake@example.com', name: 'Maya Blake' },
): Promise<void> {
  await page.goto(`${origin}/app`)
  const field = page.getByPlaceholder('you@example.com')
  await expect(field).toBeVisible({ timeout: 20_000 })
  await field.fill(who.email)
  await page.getByRole('button', { name: 'Sign in as this address' }).click()
  await expect(page.getByRole('button', { name: new RegExp(who.name) })).toBeVisible({ timeout: 20_000 })
}

/** Make a board on a workspace that has none. */
export async function makeBoard(page: Page, name = 'Team Atlas'): Promise<void> {
  const newBoard = page.getByRole('button', { name: 'New board' }).first()
  await expect(newBoard).toBeVisible({ timeout: 20_000 })
  await newBoard.click()
  await page.getByLabel('New board name').fill(name)
  await page.getByRole('button', { name: 'Create board' }).click()
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible({ timeout: 20_000 })
}

/**
 * Sign in to an instance and stand on its board, making the board if this is a fresh workspace.
 *
 * A deployment starts empty — nothing is seeded behind the administrator's back — so a spec that
 * wants a card makes the board it needs, the way a person does.
 */
export async function openInstanceBoard(
  page: Page,
  origin: string,
  name = 'Team Atlas',
  who: { email: string; name: string } = { email: 'maya.blake@example.com', name: 'Maya Blake' },
): Promise<void> {
  await signInOnInstance(page, origin, who)
  await page.goto(`${origin}/app?view=boards`)
  const empty = page.getByText('This workspace is empty')
  if (await empty.isVisible().catch(() => false)) await makeBoard(page, name)
  await page.getByRole('button', { name, exact: true }).first().click()
  await expect(page.locator('[data-workflow="cards"]')).toBeVisible({ timeout: 20_000 })
}
