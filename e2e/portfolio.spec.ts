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

  // The demo leaves one objective with no strategic initiative: the heatmap names the gap rather
  // than drawing 0%.
  const gap = heatmap.locator('[data-portfolio-row][data-risk="unserved"]')
  await expect(gap).toHaveCount(1)
  await expect(gap).toContainText('Improve reliability')
  await expect(gap).toContainText('No coverage')

  // Every reading is on screen as a word, and the legend counts the same rows.
  for (const label of ['No coverage', 'At risk', 'Overdue', 'Watch', 'On track']) {
    await expect(heatmap.getByText(label, { exact: true }).first()).toBeVisible()
  }

  // A row's objective is a door into the flow below, not only a label.
  await heatmap.getByRole('button', { name: 'Grow activation' }).click()
  await expect(page.locator('#objective-obj-activation')).toBeInViewport()
})
