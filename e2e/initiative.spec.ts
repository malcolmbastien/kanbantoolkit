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
