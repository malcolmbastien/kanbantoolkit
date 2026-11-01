import { expect, test } from '@playwright/test'

/**
 * A portfolio's risk at a glance.
 *
 * The strategy map's flows answer what serves what; the heatmap above them answers where the risk
 * is. It is derived like every other reading, so the demo's deliberately unserved objective is
 * visible as a coverage gap, and a row is a way into the flow below it.
 */
test('the portfolio heatmap shows coverage, health and a way into each objective', async ({ page }) => {
  await page.goto('/app?board=b-strategy')
  const heatmap = page.locator('[data-portfolio-heatmap]')
  await expect(heatmap).toBeVisible()
  await expect(heatmap).toContainText('Portfolio at a glance')
  await expect(heatmap.locator('[data-portfolio-row]')).toHaveCount(3)

  // The demo leaves one objective with no initiative mapped: the heatmap names the gap rather than
  // drawing 0%.
  const gap = heatmap.locator('[data-portfolio-row][data-risk="unserved"]')
  await expect(gap).toHaveCount(1)
  await expect(gap).toContainText('Improve reliability')
  await expect(gap).toContainText('None mapped')

  // An objective has no target date of its own: the date reading is the period's window, and the
  // health pill is said once rather than repeated as a legend.
  await expect(heatmap.locator('thead')).not.toContainText('Target')
  await expect(heatmap).toContainText('FY26 Q4')

  // An outcome that lives on a programme board is drawn in the objective's flow: the portfolio
  // holds no initiatives of its own — it reads the link.
  await expect(page.locator('[data-objective-group="Grow activation"]')).toContainText('Recurring revenue engine')

  // A row's objective is a door into the flow below, not only a label.
  await heatmap.getByRole('button', { name: 'Grow activation' }).click()
  await expect(page.locator('#objective-obj-activation')).toBeInViewport()
})

test('an initiative on a team board links to a portfolio objective', async ({ page }) => {
  // A team's own outcome: a root initiative, so it can serve an objective. Nothing about it is
  // placed on the portfolio — the link names the outcome, it does not move the work.
  await page.goto('/app?board=b-atlas')
  await page.getByRole('button', { name: 'Initiative', exact: true }).click()
  await expect(page.getByText('New initiative').first()).toBeVisible()

  await page.goto('/app?board=b-strategy')
  const group = page.locator('[data-objective-group="Grow activation"]')
  await expect(group).toBeVisible()
  // The picker is a compact trigger and a searchable panel, not a select the width of the page.
  await group.getByRole('button', { name: 'Map an initiative' }).click()
  await page.getByLabel('Search initiatives').fill('Team Atlas')
  const option = page.getByRole('option', { name: /New initiative/ })
  // The board names where the work lives, because it is not this one.
  await expect(option).toContainText('Team Atlas')
  await option.click()

  // It is counted, and drawn in the objective's flow, without being on the portfolio board.
  await expect(group.getByText('2 mapped')).toBeVisible()
  await expect(group.getByText('New initiative')).toBeVisible()
})

test('selecting an initiative on a portfolio does not enter focus', async ({ page }) => {
  await page.goto('/app?board=b-strategy')
  // A mapped outcome, drawn in its objective's flow but living on a programme board.
  await page.locator('[data-objective-group="Grow activation"]').getByText('Recurring revenue engine').click()

  const panel = page.locator('[data-item-panel]')
  await expect(panel).toBeVisible()
  // No focus lens and no control to start one: there is no portfolio board to dim behind the drawer.
  await expect(page.locator('[data-focus-chip]')).toHaveCount(0)
  await expect(panel.getByTitle('Focus this line on the board')).toHaveCount(0)
})

test('a portfolio board offers no card-shaped settings', async ({ page }) => {
  await page.goto('/app?board=b-strategy')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.locator('[data-board-settings]')
  await expect(dialog).toBeVisible()

  // Only the tabs a portfolio can act on: its identity, and the boards it reads beneath it.
  await expect(dialog.getByRole('tab')).toHaveText(['General', 'Boards'])

  // A portfolio reads work rather than holding it: it has no columns of its own, makes no
  // initiatives, and carries no card vocabulary — so none of that is offered here.
  for (const section of ['Card types', 'Initiative kinds', 'Tags', 'WIP limit enforcement', 'Template']) {
    await expect(dialog.getByText(section, { exact: true })).toHaveCount(0)
  }
  await expect(dialog.getByText('New cards land in')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: /Save as template/ })).toHaveCount(0)

  // What it keeps: the board's own identity, and the boards it reads beneath it.
  await expect(dialog.getByLabel('Title')).toHaveValue('Company Strategy')
  await dialog.getByRole('tab', { name: 'Boards', exact: true }).click()
  await expect(dialog.getByText('Linked boards', { exact: true })).toBeVisible()
})
