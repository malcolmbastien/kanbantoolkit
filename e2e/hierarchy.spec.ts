import { expect, test } from '@playwright/test'

/**
 * An initiative's Hierarchy reading.
 *
 * The tab is no longer only a list of what sits below: it reads the leaves' progress, the risks
 * those same leaves carry, and the planned and actual window the work supports. The child list
 * stays the direct children, and a flag narrows it to the branch that carries it.
 */

async function hierarchyOf(page: import('@playwright/test').Page, url: string) {
  await page.goto(url)
  const panel = page.locator('[data-item-panel]')
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: 'Relationships', exact: true }).click()
  return panel
}

test('an initiative reads its progress, risks and dates above its children', async ({ page }) => {
  const panel = await hierarchyOf(page, '/app?board=b-atlas&item=init-billing')

  const progress = panel.locator('[data-hierarchy-progress]')
  await expect(progress).toContainText('0%')
  await expect(progress).toContainText('0 of 5 done')
  await expect(progress).toContainText('5 leaves below it')
  await expect(progress).toContainText('Waiting 3 · Working 2 · Finished 0')
  await expect(panel.locator('[data-hierarchy-stage="backlog"]')).toContainText('1')
  await expect(panel.locator('[data-hierarchy-stage="notStarted"]')).toContainText('2')
  await expect(panel.locator('[data-hierarchy-stage="inProgress"]')).toContainText('2')
  await expect(panel.locator('[data-hierarchy-stage="done"]')).toContainText('0')

  // The bar is the card face's bar: done → in progress → not started → backlog, in the board's
  // stage colours. The old chart stack drew it the other way round in a second palette.
  const bar = progress.locator('[data-stage-progress]')
  await expect(bar).toBeVisible()
  expect(
    await bar.locator('[data-stage-segment]').evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-stage-segment')),
    ),
  ).toEqual(['inProgress', 'notStarted', 'backlog'])
  expect(
    await bar.locator('[data-stage-segment]').evaluateAll((elements) => elements.map((element) => (element as HTMLElement).style.backgroundColor)),
  ).toEqual(['rgb(124, 58, 237)', 'rgb(59, 130, 246)', 'rgb(203, 213, 225)'])

  // The flags are the work below, with the rules' own words and the count in the text.
  for (const flag of ['blocked', 'unowned', 'stale', 'overdue', 'dueSoon', 'lateStart', 'uncommitted']) {
    await expect(panel.locator(`[data-hierarchy-flag="${flag}"]`)).toBeVisible()
  }
  await expect(panel.locator('[data-hierarchy-flag="blocked"]')).toContainText('1 blocked')

  // The plan is the leaves' target window, beside the initiative's own. Actual dates appear only
  // because the demo's move history supports them.
  await expect(panel.getByText('4 of 5 dated')).toBeVisible()
  const plan = panel.locator('[data-hierarchy-plan]')
  await expect(plan).toContainText('Planned start')
  await expect(plan).toContainText('Oct 5')
  await expect(plan).toContainText('Feb 28')
  await expect(plan).toContainText('Nov 29')
  await expect(plan).toContainText('Actual start')
  await expect(plan).toContainText('Oct 1')
  await expect(plan).toContainText('Not finished')

  // The child list is the direct children, in stage order.
  await expect(panel.locator('[data-hierarchy-child]')).toHaveCount(5)
  await expect(panel.getByRole('button', { name: 'Retire the legacy coupon service' })).toBeVisible()
})

test('a flag narrows the child list, and All children restores it', async ({ page }) => {
  const panel = await hierarchyOf(page, '/app?board=b-atlas&item=init-billing')
  const blocked = panel.locator('[data-hierarchy-flag="blocked"]')
  await expect(blocked).toHaveAttribute('aria-pressed', 'false')

  await blocked.click()
  await expect(blocked).toHaveAttribute('aria-pressed', 'true')
  await expect(panel.locator('[data-hierarchy-child]')).toHaveCount(1)
  await expect(panel.locator('[data-hierarchy-child="st-coupon-retire"]')).toBeVisible()
  await expect(panel.getByRole('button', { name: 'All children' })).toBeVisible()

  await panel.getByRole('button', { name: 'All children' }).click()
  await expect(blocked).toHaveAttribute('aria-pressed', 'false')
  await expect(panel.locator('[data-hierarchy-child]')).toHaveCount(5)

  // A child row is a way into that card, in the same drawer.
  await panel.getByRole('button', { name: 'Retire the legacy coupon service' }).click()
  const reopened = page.locator('[data-item-panel]')
  await expect(reopened).toHaveAttribute('aria-label', /Retire the legacy coupon service/)
  await expect(reopened.getByLabel('Title')).toHaveValue('Retire the legacy coupon service')
})

test('an initiative with nothing below it says so, and a card’s Relationships is unchanged', async ({ page }) => {
  const empty = await hierarchyOf(page, '/app?board=b-nova&item=init-data-quality')
  await expect(empty.locator('[data-hierarchy-empty]')).toContainText('Nothing below it yet')
  await expect(empty.locator('[data-hierarchy-progress]')).toHaveCount(0)
  await expect(empty.getByText('Nothing under this yet', { exact: false })).toBeVisible()

  const card = await hierarchyOf(page, '/app?board=b-atlas&item=st-signup-rebuild')
  await expect(card.locator('[data-hierarchy-progress]')).toHaveCount(0)
  await expect(card.locator('[data-hierarchy-plan]')).toHaveCount(0)
  await expect(card.getByRole('heading', { name: 'Rolls up to' })).toBeVisible()
  await expect(card.getByRole('heading', { name: 'Breaks down into' })).toBeVisible()
})
