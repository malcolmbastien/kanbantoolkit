import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

/**
 * The Flow view's reading: a window, a cards flow and a card type, all part of the place.
 *
 * The numbers themselves are unit-tested; this spec is about the reading being real in a browser —
 * the controls change it, and a link keeps it. The heavier chart coverage arrives with the panels
 * that need it.
 */

const FLOW = '/app?board=b-atlas&view=flow'

test('a coordination board offers no Flow tab, and a Flow link lands on the board', async ({ page }) => {
  // A programme and a portfolio aggregate other boards. Neither has a cards flow, so neither has a
  // delivery flow to report. A portfolio has only its objectives, so it has no Board tab either.
  await page.goto('/app?board=b-lob')
  await expect(page.getByRole('button', { name: 'Board', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Flow', exact: true })).toHaveCount(0)
  await page.goto('/app?board=b-strategy')
  await expect(page.getByRole('button', { name: 'Board', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Flow', exact: true })).toHaveCount(0)

  // A team board still reads its own flow.
  await page.goto('/app?board=b-atlas')
  await expect(page.getByRole('button', { name: 'Flow', exact: true })).toBeVisible()

  // A link written before this rule is not an empty report: it lands on the board and the URL is
  // normalised to the place actually shown.
  await page.goto('/app?board=b-strategy&view=flow')
  await expect(page.getByRole('heading', { name: 'Portfolio at a glance' })).toBeVisible()
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
  await expect(view.getByLabel('Card type')).toHaveValue('')
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

test('a card type is part of the link', async ({ page }) => {
  await page.goto(FLOW)
  const view = page.locator('[data-flow-view]')

  // The Support queue's delivered card is a User Story; the cards in flight there are a Task and a
  // Bug. Narrowing to the story keeps the delivery and drops both of those.
  const flow = view.getByLabel('Cards flow')
  const support = await flow.locator('option', { hasText: 'Support' }).getAttribute('value')
  await flow.selectOption(support!)
  const type = view.getByLabel('Card type')
  const story = await type.locator('option', { hasText: 'User Story' }).getAttribute('value')
  await type.selectOption(story!)

  await expect(page).toHaveURL(new RegExp(`type=${story}`))
  await expect(view.locator('[data-flow-stat="In flight"] [data-flow-stat-value]')).toHaveText('0')
  await expect(view.locator('[data-flow-stat="Delivered"] [data-flow-stat-value]')).toHaveText('1')

  // The reading is the account's, not the browser's. Scoped to the view: the board behind it also
  // has labelled flow bands, and a page-wide label lookup would find those too.
  await page.reload()
  const after = page.locator('[data-flow-view]')
  await expect(after.getByLabel('Cards flow')).toHaveValue(support!)
  await expect(after.getByLabel('Card type')).toHaveValue(story!)
  await expect(after.locator('[data-flow-stat="Delivered"] [data-flow-stat-value]')).toHaveText('1')

  // Back to every type, and the URL stops naming one.
  await after.getByLabel('Card type').selectOption('')
  await expect(page).not.toHaveURL(/type=/)
})

test('the summary figures keep their columns when a number grows', async ({ page }) => {
  await page.goto(FLOW)
  const strip = page.locator('[data-flow-stat="In flight"]').locator('..')
  const stats = strip.locator('[data-flow-stat]')
  await expect(stats).toHaveCount(4)

  const cells = async () =>
    stats.evaluateAll((els) =>
      els.map((el) => {
        const box = el.getBoundingClientRect()
        return { left: Math.round(box.left), right: Math.round(box.right), top: Math.round(box.top), width: Math.round(box.width) }
      }),
    )

  // Four readings, four equal columns on one row — the shape is the card's, not the data's.
  const before = await cells()
  expect(before).toHaveLength(4)
  expect(new Set(before.map((c) => c.top)).size, 'the four readings sit on one row').toBe(1)
  for (const cell of before) expect(Math.abs(cell.width - before[0].width)).toBeLessThanOrEqual(1)

  // A value and a note that both grow by two digits must change nothing about the columns.
  await stats.evaluateAll((els) => {
    const values = ['1,234', '12,345', '1,234d', '1,234d']
    els.forEach((el, i) => {
      const value = el.querySelector('[data-flow-stat-value]')
      if (value) value.textContent = values[i]
      const note = el.lastElementChild
      if (note && note !== value) note.textContent = 'p85 1,234d · p95 1,234d · 12,345 cards · thin sample'
    })
  })
  const after = await cells()
  expect(after.map((c) => c.left)).toEqual(before.map((c) => c.left))
  expect(after.map((c) => c.width)).toEqual(before.map((c) => c.width))
})

test('a dot in the scatter is the card it stands for', async ({ page }) => {
  await page.goto(FLOW)
  const view = page.locator('[data-flow-view]')

  const dot = view.locator('[data-flow-scatter-point]').first()
  await expect(dot).toBeVisible()
  const label = (await dot.getAttribute('aria-label')) ?? ''
  const title = label.split(' (')[0]
  expect(title.length).toBeGreaterThan(0)

  // Hovering is a rich read, not the browser's title: the card, its type, dates and both times.
  // The chart is the reading; the per-card rows live in the CSV export, not under the plot.
  await expect(view.locator('[data-flow-scatter-table]')).toHaveCount(0)

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
  // The cycle-time reference line is a real line, not a hairline.
  expect(await view.locator('[data-aging-p85]').first().evaluate((el) => getComputedStyle(el).width)).toBe('2px')

  await rows.first().click()
  const panel = page.locator('[data-item-panel]')
  await expect(panel).toBeVisible()
  expect(await panel.getAttribute('aria-label')).toContain(title)
})

test('aging work chooses its columns, with Backlog off by default', async ({ page }) => {
  await page.goto(FLOW)
  const view = page.locator('[data-flow-view]')
  const rows = view.locator('[data-flow-aging-row]')

  const backlog = view.getByRole('checkbox', { name: 'Backlog', exact: true })
  const notStarted = view.getByRole('checkbox', { name: 'Not Started', exact: true })
  const inProgress = view.getByRole('checkbox', { name: 'In Progress', exact: true })

  // Inventory is not work in flight: Backlog starts off, the committed columns start on.
  await expect(rows.first()).toBeVisible()
  await expect(backlog).not.toBeChecked()
  await expect(notStarted).toBeChecked()
  await expect(inProgress).toBeChecked()
  const without = await rows.count()

  await backlog.check()
  await expect.poll(() => rows.count()).toBeGreaterThan(without)

  // No columns chosen is a state with a sentence, not an empty table.
  await backlog.uncheck()
  await notStarted.uncheck()
  await inProgress.uncheck()
  await expect(view.getByText('No cards in the selected columns.')).toBeVisible()
})

test('the cycle time distribution is drawn, with the shape said in words', async ({ page }) => {
  await page.goto(FLOW)
  const view = page.locator('[data-flow-view]')

  await expect(view.locator('[data-cycle-histogram]')).toBeVisible()
  expect(await view.locator('[data-cycle-histogram-bar]').count()).toBeGreaterThan(0)
  await expect(view.getByText(/Most finished in/)).toBeVisible()
  // The numbers are part of the panel, not folded away behind a summary — and neither table
  // repeats a "The numbers" heading over itself.
  await expect(view.locator('[data-cycle-histogram-table]')).toBeVisible()
  await expect(view.getByText('The numbers')).toHaveCount(0)

  // The indicator lines are strong enough to read over a bar, and belong to the plot: they stop
  // at the axis rather than running through the labels below it.
  for (const marker of ['p50', 'p85']) {
    const line = view.locator(`[data-cycle-marker="${marker}"]`)
    await expect(line).toBeVisible()
    expect(await line.evaluate((el) => getComputedStyle(el).width)).toBe('2px')
  }
})

test('both charts colour by card type, and name the colours', async ({ page }) => {
  await page.goto(FLOW)
  const view = page.locator('[data-flow-view]')

  // Scatter: the dots carry the card type's own colour, and the legend names every type present.
  const dots = view.locator('[data-flow-scatter-point]')
  await expect(dots.first()).toBeVisible()
  const fills = await dots.evaluateAll((dots) =>
    [...new Set(dots.map((dot) => (dot as SVGElement).style.fill))],
  )
  expect(fills.length, 'more than one type among the dots').toBeGreaterThan(1)
  const legends = view.locator('[data-flow-type-legend]')
  await expect(legends).toHaveCount(2)
  await expect(legends.first()).toContainText(/Bug|Task|User Story/)

  // Throughput: each week's bar is split into type segments, in the same colours and legend order.
  const segments = view.locator('[data-throughput-type]')
  expect(await segments.count()).toBeGreaterThan(1)
  const segmentColours = await segments.evaluateAll((els) => [...new Set(els.map((el) => (el as HTMLElement).style.backgroundColor))])
  expect(segmentColours.length).toBeGreaterThan(1)
  await expect(legends.nth(1)).toContainText(/Bug|Task|User Story/)
  // The two legends agree about who owns which colour and in what order.
  expect(await legends.nth(0).innerText()).toBe(await legends.nth(1).innerText())
})

test('the delivered cards export as CSV, and the screen keeps only the reading', async ({ page }) => {
  await page.goto(FLOW)
  const view = page.locator('[data-flow-view]')
  await expect(view.locator('[data-flow-scatter]')).toBeVisible()

  // Every card delivered in the window, not the most recent screenful: the scatter draws the
  // shape, and the file carries the rows the removed table used to hold.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    view.getByRole('button', { name: 'Export CSV' }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/-flow\.csv$/)
  const file = await readFile((await download.path())!, 'utf8')
  const lines = file.split('\r\n').filter(Boolean)
  expect(lines[0]).toBe('Card,Type,Created,Committed,Done,Lead (days),Cycle (days)')
  expect(lines.length, 'a header and at least one delivered card').toBeGreaterThan(1)
  // The demo's delivered history reaches the file, with the type a reader would recognise.
  expect(file).toContain('User Story')
})

test('the demo forecast answers with a range and the assumptions behind it', async ({ page }) => {
  // The demo carries ten archived deliveries over ten weeks, so a first visit sees the answer a
  // real team would get rather than the thin-history refusal.
  await page.goto(FLOW)
  const view = page.locator('[data-flow-view]')
  await expect(view.locator('[data-forecast]')).toBeVisible()
  await expect(view.locator('[data-forecast-refusal]')).toHaveCount(0)
  for (const share of ['p50', 'p85', 'p95']) {
    await expect(view.locator(`[data-forecast-date="${share}"]`)).not.toHaveText('—')
    await expect(view.locator(`[data-forecast-date="${share}"]`)).toContainText(/\d{4}/)
  }

  // The assumptions are on screen, with the size of the sample behind them.
  await expect(view.getByText(/5,000 trials over \d+ weeks/)).toBeVisible()
  await expect(view.getByText(/Throughput is assumed weekly/)).toBeVisible()

  // The other reading of the same trials: how much lands by a date, and for how many. With no
  // number asked for, the question is the whole open scope; a smaller N names its share of it.
  await expect(view.locator('[data-forecast-by]')).toContainText('chance all')
  await view.getByLabel('At least cards').fill('1')
  await expect(view.locator('[data-forecast-by]')).toContainText('at least 1 of')
  await expect(view.locator('[data-forecast-by]')).toContainText('open cards by then')
})

test('the service level expectation follows the share chosen', async ({ page }) => {
  await page.goto(FLOW)
  const view = page.locator('[data-flow-view]')

  const line = view.locator('[data-sle-line]')
  await expect(line).toContainText('85% of the')
  await view.getByLabel('Service level share').selectOption('50')
  await expect(line).toContainText('50% of the')
  await view.getByLabel('Service level share').selectOption('95')
  await expect(line).toContainText('95% of the')
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
  await expect(view.locator('[data-forecast-refusal]')).toContainText('Not enough history')
  await expect(view.locator('[data-forecast-by-refusal]')).toContainText('Not enough history')
  // The refusal names what would make it answer, rather than only that it will not.
  await expect(view.locator('[data-forecast-refusal]')).toContainText('Needs 4 weeks and 8 cards')
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

test('the planning cards say what they answer and what they count', async ({ page }) => {
  await page.goto(FLOW)
  const view = page.locator('[data-flow-view]')

  // The service level names its sample and what the time is measured from.
  await expect(view.locator('[data-sle-line]')).toContainText('finished here')
  await expect(view.locator('[data-sle-line]')).toContainText('from leaving Backlog')

  // Each question is stated as the thing it answers, and the open count says where it comes from.
  await expect(view.getByText('When all open cards are done', { exact: true })).toBeVisible()
  await expect(view.getByText('Chance all open cards are done by a date', { exact: true })).toBeVisible()
  const openLine = view.locator('[data-forecast]').getByText(/open cards? in /)
  await expect(openLine).toContainText('weeks of history')

  // The scope control names the cards it would add.
  await expect(view.locator('[data-forecast-scope]').getByRole('checkbox')).toBeVisible()
  await expect(view.locator('[data-forecast-scope]')).toContainText(/Include \d+ cards? in Backlog|No cards in Backlog/)
})

test('the forecast scope is one control above both questions', async ({ page }) => {
  await page.goto(FLOW)

  // The checkbox belongs to the Planning panel, not to either forecast card: it changes the
  // open count both answers are read from.
  const scope = page.locator('[data-forecast-scope]')
  const backlog = scope.getByRole('checkbox')
  await expect(backlog).toBeVisible()
  await expect(page.locator('[data-forecast] input[type="checkbox"]')).toHaveCount(0)
  await expect(page.locator('[data-forecast-by] input[type="checkbox"]')).toHaveCount(0)

  // It sits above both cards it decides, and to the side of the one it does not.
  const box = async (locator: ReturnType<typeof page.locator>) => (await locator.boundingBox())!
  const scopeBox = await box(scope)
  for (const card of ['[data-forecast]', '[data-forecast-by]']) {
    const cardBox = await box(page.locator(card))
    expect(cardBox.y, `${card} is below the shared scope`).toBeGreaterThanOrEqual(scopeBox.y + scopeBox.height - 1)
  }
  expect((await box(page.locator('[data-sle]'))).y, 'service level is beside the scope, not under it').toBeLessThan(scopeBox.y + 2)

  // Both questions read it: the open count and the "at least" ceiling move together, and the
  // service level — which does not count Backlog — does not.
  const openLine = page.locator('[data-forecast-scope-line]')
  const before = await openLine.innerText()
  const maxBefore = await page.getByLabel('At least cards').getAttribute('max')
  const sleBefore = await page.locator('[data-sle]').innerText()
  await backlog.check()
  await expect(openLine).not.toHaveText(before)
  expect(await page.getByLabel('At least cards').getAttribute('max')).not.toBe(maxBefore)
  expect(await page.locator('[data-sle]').innerText()).toBe(sleBefore)
})

test('the glossary defines the clocks the charts use', async ({ page }) => {
  await page.goto(FLOW)
  const view = page.locator('[data-flow-view]')
  const glossary = view.locator('[data-flow-glossary]')
  await expect(glossary).toBeVisible()

  for (const term of ['Created', 'Committed', 'Lead time', 'Cycle time']) {
    await expect(glossary.getByText(term, { exact: true })).toBeVisible()
  }
  // The two distinctions a reader most often gets wrong: commitment leaves Backlog, and lead
  // includes the wait there while cycle does not.
  await expect(glossary).toContainText('first time it leaves Backlog')
  await expect(glossary).toContainText('including any time it waited in Backlog')
  await expect(glossary).toContainText('the work after the card was taken on')

  // It comes before the chart that uses the terms.
  const box = (await glossary.boundingBox())!
  const scatter = (await view.locator('[data-flow-scatter]').boundingBox())!
  expect(scatter.y).toBeGreaterThan(box.y)
})
