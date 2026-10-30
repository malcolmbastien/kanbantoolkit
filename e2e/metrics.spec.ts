import { expect, test } from '@playwright/test'

/**
 * The Flow view's reading: a window and a cards flow, both part of the place.
 *
 * The numbers themselves are unit-tested; this spec is about the reading being real in a browser —
 * the controls change it, and a link keeps it. The heavier chart coverage arrives with the panels
 * that need it.
 */

const FLOW = '/app?board=b-atlas&view=flow'

test('a coordination board offers no Flow tab, and a Flow link lands on the board', async ({ page }) => {
  // A programme and a portfolio aggregate other boards. Neither has a cards flow, so neither has a
  // delivery flow to report.
  for (const boardId of ['b-lob', 'b-strategy']) {
    await page.goto(`/app?board=${boardId}`)
    await expect(page.getByRole('button', { name: 'Board', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Flow', exact: true })).toHaveCount(0)
  }

  // A team board still reads its own flow.
  await page.goto('/app?board=b-atlas')
  await expect(page.getByRole('button', { name: 'Flow', exact: true })).toBeVisible()

  // A link written before this rule is not an empty report: it lands on the board and the URL is
  // normalised to the place actually shown.
  await page.goto('/app?board=b-strategy&view=flow')
  await expect(page.getByText('Strategy map')).toBeVisible()
  await expect(page.locator('[data-flow-view]')).toHaveCount(0)
  await expect(page).not.toHaveURL(/view=flow/)
})

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

  // Hovering is a rich read, not the browser's title: the card, its type, dates and both times.
  await dot.hover()
  const tip = view.locator('[data-flow-scatter-tip]')
  await expect(tip).toBeVisible()
  await expect(tip).toContainText(title)

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
  // A type pill and a status pill, so the row reads without a separate column.
  expect(await rows.first().textContent()).toMatch(/Backlog|Not Started|In Progress|Done/)

  await rows.first().click()
  const panel = page.locator('[data-item-panel]')
  await expect(panel).toBeVisible()
  expect(await panel.getAttribute('aria-label')).toContain(title)
})

test('the cycle time distribution is drawn, with the shape said in words', async ({ page }) => {
  await page.goto(FLOW)
  const view = page.locator('[data-flow-view]')

  await expect(view.locator('[data-cycle-histogram]')).toBeVisible()
  expect(await view.locator('[data-cycle-histogram-bar]').count()).toBeGreaterThan(0)
  await expect(view.getByText(/Most finished in/)).toBeVisible()
  // The numbers are part of the panel, not folded away behind a summary.
  await expect(view.locator('[data-cycle-histogram-table]')).toBeVisible()
})

test('the forecast refuses thin history, and answers with a range when there is history', async ({ page }) => {
  // The demo's own board has three deliveries: enough for a chart, not for a forecast.
  await page.goto(FLOW)
  await expect(page.locator('[data-flow-view] [data-forecast-refusal]')).toContainText('Not enough history yet')

  // A load-test board has the history the demo does not. It is built on request and opened on the
  // next visit, because ?stress= is an intention that lands on the board itself.
  await page.goto('/app?stress=120')
  await page.goto('/app?board=stress-board&view=flow&range=all')
  const view = page.locator('[data-flow-view]')
  await expect(view.locator('[data-forecast]')).toBeVisible()
  for (const share of ['p50', 'p85', 'p95']) {
    await expect(view.locator(`[data-forecast-date="${share}"]`)).not.toHaveText('—')
    await expect(view.locator(`[data-forecast-date="${share}"]`)).toContainText(/\d{4}/)
  }

  // The assumptions are on screen, with the size of the sample behind them.
  await expect(view.getByText(/5,000 trials over \d+ weeks/)).toBeVisible()
  await expect(view.getByText(/throughput arrives weekly/)).toBeVisible()

  // The other reading of the same trials: how much lands by a date, and for how many.
  await expect(view.locator('[data-forecast-by]')).toContainText('chance of at least')
  await view.getByLabel('At least cards').fill('1')
  await expect(view.locator('[data-forecast-by]')).toContainText('at least 1 card')
})

test('the service level expectation follows the share chosen', async ({ page }) => {
  await page.goto(FLOW)
  const view = page.locator('[data-flow-view]')

  const line = view.locator('[data-sle-line]')
  await expect(line).toContainText('85% finished within')
  await view.getByLabel('Service level share').selectOption('50')
  await expect(line).toContainText('50% finished within')
  await view.getByLabel('Service level share').selectOption('95')
  await expect(line).toContainText('95% finished within')
})

test('says how much history there is, and calls a thin sample thin', async ({ page }) => {
  await page.goto(FLOW)
  const view = page.locator('[data-flow-view]')

  await expect(view.locator('[data-flow-history]')).toContainText('Moves recorded since')

  // The support queue has one delivered card: enough for a chart, not enough for a confident line.
  await view.getByLabel('Cards flow').selectOption({ label: 'Support' })
  await view.getByLabel('Range').selectOption('4')
  await expect(view.getByText(/Only 1 delivered card/)).toBeVisible()
  await expect(view.getByText(/thin sample/).first()).toBeVisible()
  // And the forecast refuses with what it would need, rather than guessing from one card.
  await expect(view.locator('[data-forecast-refusal]')).toContainText('Not enough history yet')
  await expect(view.locator('[data-forecast-by-refusal]')).toContainText('Not enough history yet')
  // The refusal names what would make it answer, rather than only that it will not.
  await expect(view.locator('[data-forecast-refusal]')).toContainText('A forecast needs 4 weeks and 8 cards')
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
