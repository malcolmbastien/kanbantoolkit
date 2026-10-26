import { expect, test } from '@playwright/test'

/**
 * An initiative with nothing below it (task 174's neighbour, and a rule of its own).
 *
 * Having no work under an initiative is a state, not a finding: the card shows it by having no
 * child pips and no rollup, and says nothing about it. A "nothing below" label and an empty
 * progress bar said "0%" about work that has not been planned, which is a different fact.
 *
 * The demo's Team Nova board has both cases: `init-lakehouse` has two cards below it, and
 * `init-data-quality` has none.
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
