import { expect, test } from '@playwright/test'
import { openBoard } from './support'

/**
 * An initiative's progress is a count of issues (task 174's neighbour, and a rule of its own).
 *
 * Having no work under an initiative is a state, not a finding: the card shows it by having no
 * child pips and no rollup, and says nothing about it. A "nothing below" label and an empty
 * progress bar said "0%" about work that has not been planned, which is a different fact.
 *
 * The board counts issues and nothing else: no card carries a number a person entered to weigh it
 * with, so the bar is the number of finished issues over the number of issues below, and the pips
 * beside it are the same fact drawn smaller. The demo's Team Nova board has both cases:
 * `init-lakehouse` has cards below it, and `init-data-quality` has none.
 */

const NOVA = '/app?board=b-nova'

test('an initiative with nothing below shows no rollup and says nothing about it', async ({ page }) => {
  await page.goto(NOVA)
  const initiatives = page.locator('[data-workflow="initiatives"]')
  await expect(initiatives).toBeVisible()

  const empty = page.locator('[data-card-id="init-data-quality"]')
  await expect(empty).toBeVisible()
  await expect(empty).not.toContainText('nothing below')
  // No children and no dependencies means no hierarchy door: there is nothing to read there.
  await expect(empty.locator('[data-open-connections]')).toHaveCount(0)
  // No percentage, which is also the progress bar: both are drawn from the same rollup.
  await expect(empty).not.toContainText(/%/)

  // The same card with work below still has its rollup — the rule is about emptiness, not bars.
  const withWork = page.locator('[data-card-id="init-lakehouse"]')
  await expect(withWork).toContainText(/\d+%/)

  // And the drawer agrees: no warning about there being nothing underneath.
  await empty.click()
  const panel = page.locator('[data-item-panel]')
  await expect(panel).toBeVisible()
  await expect(panel).not.toContainText('nothing below')
})

test('the percentage is the share of the issues below that are done', async ({ page }) => {
  await page.goto(NOVA)
  const card = page.locator('[data-card-id="init-lakehouse"]')
  await expect(card).toBeVisible()

  // The pips are the same set the percentage is counted from: one per child, each naming its
  // stage. Counting them is the check a reader can make by eye on the card.
  const pips = await card.locator('button[aria-label*=" — "]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('aria-label') ?? ''),
  )
  expect(pips.length).toBeGreaterThan(1)
  const done = pips.filter((label) => label.endsWith('Done')).length
  const shown = Number((await card.innerText()).match(/(\d+)%/)?.[1])
  expect(shown, `${done} of ${pips.length} done`).toBe(Math.round((done / pips.length) * 100))
})

test('points are gone: no card carries one, and the drawer has no estimate to enter', async ({ page }) => {
  await openBoard(page)

  // Every card on the board, and every initiative: no "pts" anywhere on a face, and no estimate
  // chip beside the priority.
  expect((await page.locator('[data-workflow="cards"]').allInnerTexts()).join('\n')).not.toContain('pts')
  await expect(page.locator('[data-workflow="initiatives"]').first()).not.toContainText('pts')

  // The drawer offers no Estimate field — nor anything else shaped like a points input.
  await page.locator('[data-workflow="cards"] [data-card-id]:not([data-card-initiative])').first().click()
  const panel = page.locator('[data-item-panel]')
  await expect(panel).toBeVisible()
  await expect(panel).not.toContainText('Estimate')
  await expect(panel).not.toContainText('pts')
  await expect(panel.locator('input[type="number"]')).toHaveCount(0)
})

test('a new initiative is offered only in the Backlog column of the initiatives workflow', async ({ page }) => {
  await openBoard(page)
  const initiatives = page.locator('[data-workflow="initiatives"]').first()
  const add = initiatives.getByRole('button', { name: 'Add initiative to Backlog' })
  await expect(add).toBeVisible()
  // Like a card, the offer belongs to the backlog: one button, and no others downstream.
  await expect(initiatives.getByRole('button', { name: /^Add initiative to / })).toHaveCount(1)
  for (const name of ['Not Started', 'In Progress', 'Done']) {
    await expect(initiatives.getByRole('button', { name: `Add initiative to ${name}` })).toHaveCount(0)
  }

  await add.click()
  const panel = page.locator('[data-item-panel]')
  await expect(panel).toHaveAttribute('aria-label', 'Card details: New initiative')
  const title = panel.getByLabel('Title')
  await expect(title).toBeFocused()
  await expect(title).toHaveValue('New initiative')
  await title.fill('A new outcome')
  await panel.getByRole('button', { name: 'Close' }).click()

  const card = initiatives.locator('[data-card-id]').filter({ hasText: 'A new outcome' })
  await expect(card).toBeVisible()
})

test('an initiative card counts its dependencies, and the count opens Hierarchy with connections', async ({ page }) => {
  await openBoard(page)
  const initiative = page.locator('[data-workflow="initiatives"] [data-card-id="init-billing"]')
  await expect(initiative).toBeVisible()

  // The door is there before any dependency exists: an initiative always has a hierarchy, so the
  // icon is not hidden just because the count is zero.
  const door = initiative.locator('[data-open-connections]')
  await expect(door).toBeVisible()
  await expect(door).not.toHaveAttribute('data-open-dependencies')
  await door.click()
  const panel = page.locator('[data-item-panel]')
  await expect(panel).toHaveAttribute('aria-label', 'Card details: Billing migration')
  await expect(panel.getByRole('button', { name: 'Hierarchy' })).toHaveClass(/text-indigo-600/)
  await expect(panel.getByTitle(/Hide this item.s connections/)).toBeVisible()
  await expect(page.locator('[data-connection-link]').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)

  // Give the initiative a dependency that is not on its own branch: the signup rebuild lives in
  // another initiative, so the link is allowed.
  await initiative.click()
  await expect(panel).toHaveAttribute('aria-label', 'Card details: Billing migration')
  await panel.getByRole('button', { name: 'Hierarchy' }).click()
  await panel.getByRole('button', { name: 'Add a dependency' }).click()
  const picker = page.locator('[data-item-picker]')
  await picker.getByLabel('Search items').fill('rebuild')
  await picker.getByRole('option', { name: /Rebuild the signup form/ }).click()
  await expect(panel.getByText('Rebuild the signup form')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)

  // The initiative wears the same count as a card does, and the badge is the same door.
  const badge = initiative.locator('[data-open-dependencies]')
  await expect(badge).toHaveAttribute('data-open-dependencies', '1')
  await badge.click()
  await expect(panel).toHaveAttribute('aria-label', 'Card details: Billing migration')
  await expect(panel.getByRole('button', { name: 'Hierarchy' })).toHaveClass(/text-indigo-600/)
  await expect(panel.getByTitle(/Hide this item.s connections/)).toBeVisible()
  await expect(page.locator('[data-connection-link]').first()).toBeVisible()
})
