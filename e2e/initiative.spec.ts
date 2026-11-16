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
  // Five leaves: one Backlog, two Not Started, two In Progress, none done.
  await expect(bar).toHaveAttribute(
    'aria-label',
    '0 of 5 leaves done — 0 done, 2 in progress, 2 not started, 1 backlog',
  )
  await expect(bar.locator('[data-stage-segment="backlog"]')).toHaveAttribute('style', /width: 20%/)
  await expect(bar.locator('[data-stage-segment="notStarted"]')).toHaveAttribute('style', /width: 40%/)
  await expect(bar.locator('[data-stage-segment="inProgress"]')).toHaveAttribute('style', /width: 40%/)
  await expect(bar.locator('[data-stage-segment="done"]')).toHaveCount(0)
  // A leaf whose planned start has passed is a warning on the initiative's face, not only in the drawer.
  await expect(billing).toContainText('1 late start')

  // The pips read in the bar's order too: in progress, not started, backlog.
  expect(
    await billing
      .locator('button[aria-label*=" — "]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label')?.split(' — ')[1])),
  ).toEqual(['In Progress', 'In Progress', 'Not Started', 'Not Started', 'Backlog'])

  // A finished leaf is the first segment, and the rest of the work is still its own share.
  const signup = page.locator('[data-card-id="init-signup-redesign"]')
  const signupBar = signup.locator('[data-stage-progress]')
  await expect(signupBar.locator('[data-stage-segment="done"]')).toBeVisible()
  await expect(signupBar.locator('[data-stage-segment="inProgress"]')).toBeVisible()
  await expect(signupBar).toHaveAttribute('aria-label', /1 of 3 leaves done/)
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

test('a discarded child is out of the progress on the card and in the drawer', async ({ page }) => {
  await openBoard(page)

  // Throw one of the three Signup redesign leaves away.
  await page.locator('[data-card-id="st-signup-validation"]').click({ button: 'right' })
  const menu = page.locator('[data-card-menu][role="menu"]').first()
  await menu.getByRole('button', { name: /Discard|Archive/ }).click()
  await page.locator('[data-confirm-dialog]').getByRole('button', { name: /Discard|Archive/, exact: true }).last().click()
  await expect(page.locator('[data-card-id="st-signup-validation"]')).toHaveCount(0)

  // The card face counts the two leaves that remain, not the one that was thrown away.
  const card = page.locator('[data-card-id="init-signup-redesign"]')
  await expect(card).toContainText('50%')
  await expect(card.locator('[data-stage-progress]')).toHaveAttribute(
    'aria-label',
    '1 of 2 leaves done — 1 done, 1 in progress, 0 not started, 0 backlog',
  )

  // The drawer reads the same two leaves, so the card and its hierarchy cannot disagree.
  await card.click()
  const panel = page.locator('[data-item-panel]')
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: 'Hierarchy', exact: true }).click()
  const progress = panel.locator('[data-hierarchy-progress]')
  await expect(progress).toContainText('50%')
  await expect(progress).toContainText('1 of 2 done')
  await expect(progress).toContainText('2 leaves below it')
  await expect(panel.locator('[data-hierarchy-flag="discarded"]')).toContainText('1 discarded')
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

test('an initiative card counts its dependencies, and the count opens Hierarchy with connections', async ({ page }) => {
  await openBoard(page)
  const initiative = page.locator('[data-workflow="initiatives"] [data-card-id="init-billing"]')
  await expect(initiative).toBeVisible()

  // The door is there before any dependency exists: an initiative always has a hierarchy, so the
  // icon is not hidden just because the count is zero.
  const door = initiative.locator('[data-open-connections]')
  await expect(door).toBeVisible()
  await expect(door).not.toHaveAttribute('data-open-dependencies')
  await door.click()
  const panel = page.locator('[data-item-panel]')
  await expect(panel).toHaveAttribute('aria-label', 'Card details: Billing migration')
  await expect(panel.getByRole('button', { name: 'Hierarchy' })).toHaveClass(/text-indigo-600/)
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
  await panel.getByRole('button', { name: 'Hierarchy' }).click()
  await panel.getByRole('button', { name: 'Add a dependency' }).click()
  const picker = page.locator('[data-item-picker]')
  await picker.getByLabel('Search items').fill('rebuild')
  await picker.getByRole('option', { name: /Rebuild the signup form/ }).click()
  await expect(panel.getByText('Rebuild the signup form')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)

  // The initiative wears the same count as a card does, and the badge is the same door.
  const badge = initiative.locator('[data-open-dependencies]')
  await expect(badge).toHaveAttribute('data-open-dependencies', '1')
  await badge.click()
  await expect(panel).toHaveAttribute('aria-label', 'Card details: Billing migration')
  await expect(panel.getByRole('button', { name: 'Hierarchy' })).toHaveClass(/text-indigo-600/)
  await expect(panel.getByTitle(/Hide this item.s connections/)).toBeVisible()
  await expect(page.locator('[data-connection-link]').first()).toBeVisible()
})
