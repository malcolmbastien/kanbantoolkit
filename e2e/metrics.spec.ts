import { expect, test } from '@playwright/test'

/**
 * The Flow view's reading: a window and a cards flow, both part of the place.
 *
 * The numbers themselves are unit-tested; this spec is about the reading being real in a browser —
 * the controls change it, and a link keeps it. The heavier chart coverage arrives with the panels
 * that need it.
 */

const FLOW = '/app?board=b-atlas&view=flow'

test('the Flow view opens on a quarter of every cards flow', async ({ page }) => {
  await page.goto(FLOW)

  const view = page.locator('[data-flow-view]')
  await expect(view).toBeVisible()
  // The demo has two cards flows, so the filter is offered and starts on all of them.
  await expect(view.getByLabel('Range')).toHaveValue('12')
  await expect(view.getByLabel('Cards flow')).toHaveValue('')
  // Twelve weekly buckets in the cumulative flow, and twelve in throughput.
  await expect(view.locator('[data-flow-bucket]')).toHaveCount(12)
  await expect(view.locator('[data-flow-week]')).toHaveCount(12)
})

test('a window and a flow are part of the link', async ({ page }) => {
  await page.goto(FLOW)
  const view = page.locator('[data-flow-view]')

  await view.getByLabel('Range').selectOption('4')
  await expect(view.locator('[data-flow-bucket]')).toHaveCount(4)
  await expect(view.locator('[data-flow-week]')).toHaveCount(4)
  await expect(page).toHaveURL(/range=4/)

  // The support queue on the demo board holds one waiting and one under way, and one answered.
  const flow = view.getByLabel('Cards flow')
  const support = await flow.locator('option', { hasText: 'Support' }).getAttribute('value')
  expect(support).toBeTruthy()
  await flow.selectOption(support!)
  await expect(page).toHaveURL(new RegExp(`flow=${support}`))
  await expect(view.locator('[data-flow-stat="In flight"] [data-flow-stat-value]')).toHaveText('2')
  await expect(view.locator('[data-flow-stat="Delivered"] [data-flow-stat-value]')).toHaveText('1')

  // The reading is the account's, not the browser's: a reload opens the same one.
  await page.reload()
  await expect(page.getByLabel('Range')).toHaveValue('4')
  await expect(page.getByLabel('Cards flow')).toHaveValue(support!)
  await expect(page.locator('[data-flow-stat="In flight"] [data-flow-stat-value]')).toHaveText('2')

  // Back to every flow, and the URL stops naming one.
  await page.getByLabel('Cards flow').selectOption('')
  await expect(page).not.toHaveURL(/flow=/)
})

test('a dot in the scatter is the card it stands for', async ({ page }) => {
  await page.goto(FLOW)
  const view = page.locator('[data-flow-view]')

  const dot = view.locator('[data-flow-scatter-point]').first()
  await expect(dot).toBeVisible()
  const label = (await dot.getAttribute('aria-label')) ?? ''
  const title = label.split(':')[0]
  expect(title.length).toBeGreaterThan(0)

  await dot.click()
  const panel = page.locator('[data-item-panel]')
  await expect(panel).toBeVisible()
  // The title is an editable field, not text: the panel's own name is what says which card opened.
  expect(await panel.getAttribute('aria-label')).toContain(title)
})

test('aging work lists what is old, and a row opens the card', async ({ page }) => {
  await page.goto(FLOW)
  const view = page.locator('[data-flow-view]')

  const rows = view.locator('[data-flow-aging-row]')
  await expect(rows.first()).toBeVisible()
  expect(await rows.count()).toBeGreaterThan(0)
  const title = (await rows.first().locator('[data-flow-aging-title]').textContent())?.trim() ?? ''
  expect(title.length).toBeGreaterThan(0)

  await rows.first().click()
  const panel = page.locator('[data-item-panel]')
  await expect(panel).toBeVisible()
  expect(await panel.getAttribute('aria-label')).toContain(title)
})

test('a reading this build does not know falls back to the default, not to a blank screen', async ({ page }) => {
  await page.goto(`${FLOW}&range=7&flow=f-missing`)

  const view = page.locator('[data-flow-view]')
  await expect(view).toBeVisible()
  await expect(view.getByLabel('Range')).toHaveValue('12')
  await expect(view.getByLabel('Cards flow')).toHaveValue('')
  // The URL is normalised to the reading actually shown: one place, one link.
  await expect(page).not.toHaveURL(/range=7/)
  await expect(page).not.toHaveURL(/flow=/)
})
