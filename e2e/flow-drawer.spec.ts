import { expect, test, type Page } from '@playwright/test'
import { addCardTo, lane, openBoard } from './support'

/**
 * A card's own flow reading, in the drawer (tasks 214 and 225), now in **History**.
 *
 * The numbers are derived from the card's log, so these tests read the shape a person sees rather
 * than a fixed date: an in-flight card has an open age, a cycle once committed and the cell it is
 * in; a delivered card has a final lead and cycle; an initiative reads its rollup and leaves and
 * never claims a cycle of its own. The reading is in History, with the stage breakdown, so a busy
 * Overview stays about the card's fields.
 */

async function openHistory(page: Page): Promise<void> {
  await page.locator('[data-item-panel]').getByRole('button', { name: 'Flow & History', exact: true }).click()
}

test('an in-flight card reads its open age, cycle and current cell', async ({ page }) => {
  await openBoard(page)
  await lane(page, 'Dev').locator('[data-card-id]').first().click()
  await openHistory(page)

  const flow = page.locator('[data-flow-detail]')
  await expect(flow).toBeVisible()
  await expect(flow.locator('[data-flow-stat="open"]')).toContainText('Open')
  await expect(flow.locator('[data-flow-stat="open"]')).toContainText(/\d/)
  await expect(flow.locator('[data-flow-stat="cycle"]')).toContainText('Cycle')
  await expect(flow.locator('[data-flow-stat="cycle"]')).not.toContainText('Not yet')
  await expect(flow.locator('[data-flow-stat="position"]')).toContainText('Dev')
  // The summary and the stage breakdown are one section here.
  await expect(flow.locator('[data-flow-stage]')).toHaveCount(4)
  await expect(flow.locator('[data-flow-comparison]')).toBeVisible()
  // One heading, and the numbers are text rather than a colour-only reading.
  await expect(flow.getByRole('heading', { name: 'Flow' })).toBeVisible()
})

test('a delivered card reads its final lead and cycle, and stops counting', async ({ page }) => {
  await openBoard(page)
  await lane(page, 'Done').locator('[data-card-id]').first().click()
  await openHistory(page)

  const flow = page.locator('[data-flow-detail]')
  await expect(flow).toBeVisible()
  await expect(flow.locator('[data-flow-stat="open"]')).toContainText('Lead')
  await expect(flow.locator('[data-flow-stat="cycle"]')).toContainText('Cycle')
  await expect(flow.locator('[data-flow-stat="position"]')).toContainText('Delivered')
})

test('the full stage breakdown is in History, not behind a link', async ({ page }) => {
  await openBoard(page)
  await lane(page, 'Dev').locator('[data-card-id]').first().click()
  await openHistory(page)

  const detail = page.locator('[data-flow-detail]')
  await expect(detail).toBeVisible()
  await expect(detail.getByRole('heading', { name: 'Flow' })).toBeVisible()
  await expect(detail.locator('[data-flow-stage]')).toHaveCount(4)
  await expect(detail.locator('[data-flow-stage="inProgress"]')).toContainText('In Progress')
  await expect(detail.locator('[data-flow-stage="inProgress"]')).toContainText('now')
  await expect(detail.locator('[data-flow-comparison]')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible()
})

test('a card with no recorded moves still says how long it has been open', async ({ page }) => {
  await openBoard(page)
  await addCardTo(page, 'Backlog')
  await lane(page, 'Backlog').locator('[data-card-id]').first().click()
  await openHistory(page)

  const flow = page.locator('[data-flow-detail]')
  await expect(flow).toBeVisible()
  await expect(flow.locator('[data-flow-stat="open"]')).toContainText('Open')
  await expect(flow.locator('[data-flow-stat="cycle"]')).toContainText('Not yet')
  await expect(flow.locator('[data-flow-stat="position"]')).toContainText('Backlog')
})

test('an initiative reads its rollup and leaves, and never invents a cycle', async ({ page }) => {
  await openBoard(page)
  await page.locator('[data-card-initiative]').first().click()
  await openHistory(page)

  const flow = page.locator('[data-initiative-flow]')
  await expect(flow).toBeVisible()
  await expect(flow.locator('[data-flow-stat="progress"]')).toContainText('%')
  await expect(flow.locator('[data-flow-stat="leaves"]')).toContainText('/')
  await expect(flow.locator('[data-flow-stat="leaves"]')).toContainText('Leaves done')
  await expect(flow.locator('[data-flow-distribution]')).toContainText('Backlog')
  await expect(flow.locator('[data-flow-distribution]')).toContainText('Done')
  await expect(flow.locator('[data-flow-movement]')).toContainText(/Last moved|Movement not loaded/)
  // The one thing an initiative must not show is a cycle time of its own.
  await expect(flow).not.toContainText('Cycle ')
})
