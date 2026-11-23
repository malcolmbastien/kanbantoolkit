import { expect, test } from '@playwright/test'
import { laneRegion, openBoard } from './support'

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

test('the progress bar is the children by stage, not a single fill', async ({ page }) => {
  await openBoard(page)
  const billing = page.locator('[data-card-id="init-billing"]')
  await expect(billing).toBeVisible()
  const bar = billing.locator('[data-stage-progress]')
  await expect(bar).toBeVisible()
  // Five items: one Backlog, two Not Started, two In Progress, none done.
  await expect(bar).toHaveAttribute(
    'aria-label',
    '0 of 5 items done — 0 done, 2 in progress, 2 not started, 1 backlog',
  )
  await expect(bar.locator('[data-stage-segment="backlog"]')).toHaveAttribute('style', /width: 20%/)
  await expect(bar.locator('[data-stage-segment="notStarted"]')).toHaveAttribute('style', /width: 40%/)
  await expect(bar.locator('[data-stage-segment="inProgress"]')).toHaveAttribute('style', /width: 40%/)
  await expect(bar.locator('[data-stage-segment="done"]')).toHaveCount(0)
  // An item whose planned start has passed is a warning on the initiative's face, not only in the drawer.
  await expect(billing).toContainText('1 late start')

  // The pips read in the bar's order too: in progress, not started, backlog. The stage is its own
  // attribute, so a marker added to the pip's name does not change the order being read.
  expect(
    await billing
      .locator('[data-child-pip]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-pip-stage'))),
  ).toEqual(['inProgress', 'inProgress', 'notStarted', 'notStarted', 'backlog'])

  // A finished item is the first segment, and the rest of the work is still its own share.
  const signup = page.locator('[data-card-id="init-signup-redesign"]')
  const signupBar = signup.locator('[data-stage-progress]')
  await expect(signupBar.locator('[data-stage-segment="done"]')).toBeVisible()
  await expect(signupBar.locator('[data-stage-segment="inProgress"]')).toBeVisible()
  await expect(signupBar).toHaveAttribute('aria-label', /1 of 3 items done/)
})

test('an initiative wears its due date and Done stamp in the footer, like a card', async ({ page }) => {
  await openBoard(page)
  const withDue = page.locator('[data-card-id="init-signup-redesign"]')
  const footer = withDue.locator('[data-card-footer]')
  await expect(footer).toBeVisible()
  await expect(footer.locator('[data-due]')).toBeVisible()
  // The badge is in the foot, not in the pips/progress row above it.
  await expect(withDue.locator('[data-due]')).toHaveCount(1)

  const done = page.locator('[data-card-id="init-slo"]')
  const doneFooter = done.locator('[data-card-footer]')
  await expect(doneFooter).toBeVisible()
  await expect(doneFooter.getByText('Done', { exact: true })).toBeVisible()
  await expect(done).toContainText('Done')
})

test('hovering a child pip reads the child without opening it', async ({ page }) => {
  await openBoard(page)
  const pip = page.locator('[data-card-id="init-signup-redesign"] [data-pip-for="st-signup-validation"]')
  await expect(pip).toBeVisible()
  await pip.hover()

  const preview = page.locator('[data-pip-preview]')
  await expect(preview).toBeVisible()
  // The stage is a field of its own rather than a sentence over the panel.
  await expect(preview.locator('[data-pip-status]')).toHaveText('In Progress')
  await expect(preview).toContainText('Signup validation on retry')
  await expect(preview).toContainText('Bug')
  // Priority wears the same icon the card does, not a grey word.
  await expect(preview.locator('[aria-label="Priority: High"]')).toBeVisible()
  // The amber marker's reason is named, in the card's own warning words.
  const warnings = preview.locator('[data-pip-warnings]')
  await expect(warnings).toBeVisible()
  await expect(warnings).toContainText(/overdue/i)
  // It sits directly under the title, above the metadata, so a warning is read before the facts.
  const warningsBox = (await warnings.boundingBox())!
  const peopleBox = (await preview.getByText('People', { exact: true }).boundingBox())!
  expect(warningsBox.y).toBeLessThan(peopleBox.y)
  // The native title that used to sit on the pip and its row would draw a second tooltip over
  // this one; the pip's accessible name and the panel are the reading now.
  await expect(pip).not.toHaveAttribute('title')
  await expect(page.locator('[data-child-pips]').first()).not.toHaveAttribute('title')
  await expect(preview).toContainText('Maya Blake')
  await expect(preview).toContainText('customer-facing')
  await expect(preview.locator('[data-due]')).toBeVisible()
  await expect(preview).toContainText('Team Atlas')
  await expect(preview).toContainText('Cards')
  await expect(preview).toContainText('In Progress / Test')

  // Visual only: moving away closes it, and the pip is still the way in.
  await page.mouse.move(600, 120)
  await expect(preview).toHaveCount(0)
  await pip.click()
  const panel = page.locator('[data-item-panel]')
  await expect(panel).toBeVisible()
  await expect(panel.getByLabel('Title')).toHaveValue('Signup validation on retry')
})

test('opening a pip unfolds a folded workflow and column and selects the card', async ({ page }) => {
  await openBoard(page)
  // Fold the child's column, then the whole Cards workflow that holds it.
  await laneRegion(page, 'Test').getByTitle('Collapse column').first().click()
  await page.getByRole('button', { name: 'Collapse Cards' }).click()
  await expect(page.getByRole('button', { name: 'Expand Cards' })).toBeVisible()

  // The pip lives in the initiatives flow, which is still open above the folded band.
  const pip = page.locator('[data-card-id="init-signup-redesign"] [data-pip-for="st-signup-validation"]')
  await pip.click()

  // The pip's request is to see the child: the band and the cell unfold, the drawer opens, and
  // the board's reveal brings the card itself into view.
  await expect(page.getByRole('button', { name: 'Collapse Cards' })).toBeVisible()
  const card = page.locator('[data-workflow="cards"] [data-card-id="st-signup-validation"]')
  await expect(card).toBeVisible()
  await expect(card).toBeInViewport()
  await expect(page.locator('[data-item-panel]')).toBeVisible()
  await expect(page.getByLabel('Title')).toHaveValue('Signup validation on retry')
})

test('a pip marks a blocked child and a child that needs attention', async ({ page }) => {
  await openBoard(page)
  const billing = page.locator('[data-card-id="init-billing"]')
  const blocked = billing.locator('[data-pip-for="st-coupon-retire"]')
  // The whole pip becomes the alert, with the ban mark centred in it.
  await expect(blocked).toHaveAttribute('data-pip-marker', 'blocked')
  await expect(blocked).toHaveClass(/border-rose-600/)
  await expect(blocked.locator('svg')).toHaveCount(1)
  await expect(blocked).toHaveAttribute('aria-label', /blocked/)

  const warned = billing.locator('[data-pip-for="st-pricing-cache"]')
  await expect(warned).toHaveAttribute('data-pip-marker', 'warning')
  await expect(warned).toHaveClass(/border-amber-500/)
  await expect(warned.locator('svg')).toHaveCount(1)
  await expect(warned).toHaveAttribute('aria-label', /has a warning/)

  // A finished child has nothing to raise, and stays a plain stage pip with no icon.
  const clean = page.locator('[data-card-id="init-signup-redesign"] [data-pip-for="st-signup-screens"]')
  await expect(clean).not.toHaveAttribute('data-pip-marker')
  await expect(clean.locator('svg')).toHaveCount(0)
})

test('a discarded child is out of the progress on the card and in the drawer', async ({ page }) => {
  await openBoard(page)

  // Throw one of the three Signup redesign items away.
  await page.locator('[data-card-id="st-signup-validation"]').click({ button: 'right' })
  const menu = page.locator('[data-card-menu][role="menu"]').first()
  await menu.getByRole('button', { name: /Discard|Archive/ }).click()
  await page.locator('[data-confirm-dialog]').getByRole('button', { name: /Discard|Archive/, exact: true }).last().click()
  await expect(page.locator('[data-card-id="st-signup-validation"]')).toHaveCount(0)

  // The card face counts the two items that remain, not the one that was thrown away.
  const card = page.locator('[data-card-id="init-signup-redesign"]')
  await expect(card).toContainText('50%')
  await expect(card.locator('[data-stage-progress]')).toHaveAttribute(
    'aria-label',
    '1 of 2 items done — 1 done, 1 in progress, 0 not started, 0 backlog',
  )

  // The drawer reads the same two items, so the card and its hierarchy cannot disagree.
  await card.click()
  const panel = page.locator('[data-item-panel]')
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: 'Relationships', exact: true }).click()
  const progress = panel.locator('[data-hierarchy-progress]')
  await expect(progress).toContainText('50%')
  await expect(progress).toContainText('1 of 2 done')
  await expect(progress).toContainText('2 items below it')
  await expect(panel.locator('[data-hierarchy-flag="discarded"]')).toContainText('1 discarded')
})

test('a card becomes an initiative from its menu, keeping the item and its history', async ({ page }) => {
  await openBoard(page)
  const id = 'st-usage-billing'
  const cards = page.locator('[data-workflow="cards"]')
  const initiatives = page.locator('[data-workflow="initiatives"]')
  const card = cards.locator(`[data-card-id="${id}"]`)
  await expect(card).toBeVisible()

  await card.click({ button: 'right' })
  await page.locator('[data-card-menu][role="menu"]').first().getByRole('button', { name: 'Convert to initiative' }).click()
  const dialog = page.locator('[data-confirm-dialog]')
  await expect(dialog).toContainText('Convert')
  await dialog.getByRole('button', { name: 'Convert', exact: true }).click()

  // It leaves the cards flow and reads as an initiative in the section of the stage it was in.
  await expect(cards.locator(`[data-card-id="${id}"]`)).toHaveCount(0)
  const converted = initiatives.locator(`[data-card-id="${id}"]`)
  await expect(converted).toBeVisible()
  await expect(page.locator('[data-announcer]')).toContainText(
    'Converted “Add usage-based billing events” to an initiative.',
  )

  // The same item: its title, people, type label in the history and every earlier entry survive.
  await converted.click()
  const panel = page.locator('[data-item-panel]')
  await expect(panel).toBeVisible()
  await expect(panel.getByLabel('Title')).toHaveValue('Add usage-based billing events')
  await panel.getByRole('button', { name: 'Flow & History', exact: true }).click()
  await expect(panel).toContainText('Converted from a card (was User Story)')
  await page.keyboard.press('Escape')

  // It is an initiative now, so it is not offered again.
  await converted.click({ button: 'right' })
  await expect(page.locator('[data-card-menu][role="menu"]')).not.toContainText('Convert to initiative')
  await page.keyboard.press('Escape')

  // Content and design, not view state: a reload keeps the new reading.
  await page.reload()
  await expect(page.locator('[data-workflow="initiatives"]').locator(`[data-card-id="${id}"]`)).toBeVisible()
  await expect(page.locator('[data-workflow="cards"]').locator(`[data-card-id="${id}"]`)).toHaveCount(0)
})

test('the conversion is one card at a time, never a group', async ({ page }) => {
  await openBoard(page)
  const cards = page.locator('[data-workflow="cards"]')
  await cards.locator('[data-card-id="st-usage-billing"]').click({ modifiers: ['Shift'] })
  await cards.locator('[data-card-id="st-pricing-experiment"]').click({ modifiers: ['Shift'] })
  await expect(page.locator('[data-bulk-actions]')).toContainText('2 selected')

  await cards.locator('[data-card-id="st-pricing-experiment"]').click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Card actions' })
  await expect(menu).toBeVisible()
  // Each conversion has its own stage and its own old type to record; a group has no single answer.
  await expect(menu).not.toContainText('Convert to initiative')
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

test('an initiative card opens its hierarchy and dependencies, and counts only open dependencies', async ({ page }) => {
  await openBoard(page)
  const initiative = page.locator('[data-workflow="initiatives"] [data-card-id="init-billing"]')
  await expect(initiative).toBeVisible()

  // The door is there for the hierarchy; with no open dependencies it is the icon alone.
  const door = initiative.locator('[data-open-connections]')
  await expect(door).toBeVisible()
  await expect(door).not.toHaveAttribute('data-open-dependencies')
  await door.click()
  const panel = page.locator('[data-item-panel]')
  await expect(panel).toHaveAttribute('aria-label', 'Card details: Billing migration')
  await expect(panel.getByRole('button', { name: 'Relationships', exact: true })).toHaveClass(/text-indigo-600/)
  await expect(panel.getByTitle(/Hide this item.s connections/)).toBeVisible()
  await expect(page.locator('[data-connection-link]').first()).toBeVisible()
  await expect(door).toHaveAttribute('aria-pressed', 'true')

  // Pressing the same door again dismisses the drawer and cancels the scoped connections.
  await door.click()
  await expect(panel).toHaveCount(0)
  await expect(door).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)

  // Give the initiative a dependency that is not on its own branch: the signup rebuild lives in
  // another initiative, so the link is allowed.
  await initiative.click()
  await expect(panel).toHaveAttribute('aria-label', 'Card details: Billing migration')
  await panel.getByRole('button', { name: 'Relationships', exact: true }).click()
  await panel.getByRole('button', { name: 'Add a dependency' }).click()
  const picker = page.locator('[data-item-picker]')
  await picker.getByLabel('Search items').fill('rebuild')
  await picker.getByRole('option', { name: /Rebuild the signup form/ }).click()
  await expect(panel.getByText('Rebuild the signup form')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)

  // The new dependency is the only thing counted: the children are already pips, and archived or
  // done children are not live waits.
  const badge = initiative.locator('[data-open-dependencies]')
  await expect(badge).toHaveAttribute('data-open-dependencies', '1')
  await expect(badge).toHaveAttribute('aria-label', /^Waiting on 1/)
  await badge.click()
  await expect(panel).toHaveAttribute('aria-label', 'Card details: Billing migration')
  await expect(panel.getByRole('button', { name: 'Relationships', exact: true })).toHaveClass(/text-indigo-600/)
  await expect(panel.getByTitle(/Hide this item.s connections/)).toBeVisible()
  await expect(page.locator('[data-connection-link]').first()).toBeVisible()
})

test('a mapped initiative says why it stays top-level, and clearing the objective opens the parent picker', async ({ page }) => {
  await page.goto('/app?board=b-lob')
  const card = page.locator('[data-workflow="initiatives"] [data-card-id="init-revenue"]')
  await expect(card).toBeVisible()
  await card.click()
  const panel = page.locator('[data-item-panel]')
  await panel.getByRole('button', { name: 'Relationships', exact: true }).click()

  // The parent section is not a picker with nothing in it: it names the objective that keeps the
  // initiative at the top, and offers the one act that resolves it.
  await expect(panel.getByRole('button', { name: 'Change parent' })).toHaveCount(0)
  await expect(panel.getByText('Serves Grow activation.')).toBeVisible()
  await expect(panel.getByText(/A mapped initiative stays top-level/)).toBeVisible()

  await panel.getByRole('button', { name: 'Clear objective' }).click()
  // Clearing it is the explicit act; the parent editor is then offered with real candidates.
  await expect(panel.getByText('No objective yet.')).toBeVisible()
  await expect(panel.locator('select').first()).toContainText('Platform consolidation')
  await expect(panel.getByRole('button', { name: 'Set parent' })).toBeVisible()
})

test('a mapped initiative does not offer a parent pick from its card menu', async ({ page }) => {
  await page.goto('/app?board=b-lob')
  const card = page.locator('[data-workflow="initiatives"] [data-card-id="init-revenue"]')
  await card.click({ button: 'right' })
  const menu = page.locator('[data-card-menu][role="menu"]').first()
  await expect(menu.getByText('Set parent…')).toHaveCount(0)
  await expect(menu.getByText(/Serves Grow activation/)).toBeVisible()
})

test('an initiative\'s own overdue warning is in the top summary, not only by the due date', async ({ page }) => {
  await openBoard(page)
  await page.locator('[data-card-id="init-signup-redesign"]').click()
  const panel = page.locator('[data-item-panel]')
  const warnings = panel.locator('[data-card-warnings]')
  await expect(warnings).toBeVisible()
  await expect(warnings.getByRole('button', { name: 'Overdue', exact: true })).toBeVisible()
  await expect(warnings).toContainText(/18d overdue|overdue/i)
})
