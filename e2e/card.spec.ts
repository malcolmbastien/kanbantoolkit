import { expect, test } from '@playwright/test'
import { openBoard } from './support'

/**
 * The card face reads top-down: what the card *is* — its type and title, then the work it rolls up
 * to — then what it is asking a reader to look at, and finally, on one quiet rule at the foot, its
 * measurements: its sub-tasks, how long it has sat in the lane, and who has it.
 *
 * The roll-up is a decoration, not a door. It has spent releases in the foot row, where it crowded
 * exactly the facts that row is reserved for, and as a link, where pressing a card's own face opened
 * a different card in the drawer. These pin both halves: where it sits, and that it does nothing.
 */

/** The face's geometry, in one measurement: what is where, and on whose row. */
async function face(page: import('@playwright/test').Page, id: string) {
  return page.locator(`[data-card-id="${id}"]`).evaluate((card) => {
    const box = (node: Element | null) => {
      if (!node) return null
      const rect = node.getBoundingClientRect()
      return { top: Math.round(rect.top), bottom: Math.round(rect.bottom) }
    }
    return {
      rollup: box(card.querySelector('[title^="Rolls up to"]')),
      // The title is the card's own words, found by its text rather than by a class.
      title: box([...card.querySelectorAll('div')].find((d) => d.textContent?.trim() === 'Rebuild the signup form') ?? null),
      checklist: box(card.querySelector('[title^="Checklist"]')),
      age: box(card.querySelector('[title$="days in this lane"]')),
      people: box(card.querySelector('[class*="-space-x-1.5"]')),
      // Anything a reader could press *on the roll-up itself*: there must be nothing, and the line
      // itself must not be the control.
      control:
        card.querySelector('button[title^="Rolls up to"], a[title^="Rolls up to"]') ??
        card.querySelector('[title^="Rolls up to"] button, [title^="Rolls up to"] a'),
    }
  })
}

test('the roll-up sits under the title, and the foot keeps its measurements', async ({ page }) => {
  await openBoard(page)

  // The seeded card that has all of them: a parent, a checklist, a lane age and an assignee.
  const shape = await face(page, 'st-signup-rebuild')
  expect(shape.rollup, 'the roll-up is on the face').not.toBeNull()
  expect(shape.title, 'the card has a title').not.toBeNull()
  expect(shape.checklist, 'the card has a checklist').not.toBeNull()
  expect(shape.age, 'the card has a lane age').not.toBeNull()
  expect(shape.people, 'the card has an assignee').not.toBeNull()

  // Under the title: the card's own words first, then the parent it sits under.
  expect(shape.rollup!.top, 'the roll-up sits under the title').toBeGreaterThanOrEqual(shape.title!.bottom)
  // …and nothing on it is a control.
  expect(shape.control, 'the roll-up holds nothing to press').toBeNull()

  // The foot is one row: the three measurements line up with each other, and keep to themselves.
  const tops = [shape.checklist!.top, shape.age!.top, shape.people!.top]
  expect(Math.max(...tops) - Math.min(...tops), 'the foot is one row of measurements').toBeLessThanOrEqual(8)
  expect(shape.rollup!.bottom, 'the roll-up stays out of the foot row').toBeLessThanOrEqual(Math.min(...tops))
})

test('pressing the roll-up opens the card it sits on, not the card it names', async ({ page }) => {
  await openBoard(page)
  const card = page.locator('[data-card-id="st-signup-rebuild"]')
  const rollup = card.locator('[title^="Rolls up to"]')
  // The visible title, without the "Rolls up to" the screen reader is given.
  const parent = (await rollup.locator('span').last().innerText()).trim()
  expect(parent).not.toBe('')

  // It is not offered as a button or a link: a card has one gesture, and it opens this card.
  await expect(card.getByRole('button', { name: parent, exact: true })).toHaveCount(0)
  await expect(card.getByRole('link', { name: parent, exact: true })).toHaveCount(0)

  await rollup.click()
  await expect(page.locator('[data-item-panel]')).toHaveAttribute(
    'aria-label',
    'Card details: Rebuild the signup form',
  )
})

test('priority keeps the top-right corner when the card has no type', async ({ page }) => {
  await openBoard(page)

  // The seeded card in Backlog, given a type of None and a priority: the card is a card without
  // its leading chip, and the weight a reader scans for must not move to where the chip was.
  await page.locator('[data-card-id="st-usage-billing"]').click()
  const panel = page.locator('[data-item-panel]')
  await panel.getByRole('button', { name: /^Type:/ }).click()
  await panel.getByRole('option', { name: 'None' }).click()
  await panel.locator('label', { hasText: 'Priority' }).locator('button').first().click()
  await panel.getByRole('button', { name: 'High', exact: true }).click()
  await page.getByRole('button', { name: 'Close' }).click()

  const mark = page.locator('[data-card-id="st-usage-billing"] [role="img"][aria-label^="Priority"]')
  await expect(mark).toBeVisible()
  const gap = await page.locator('[data-card-id="st-usage-billing"]').evaluate((card) => {
    const badge = card.querySelector('[role="img"][aria-label^="Priority"]')!
    return Math.round(card.getBoundingClientRect().right - badge.getBoundingClientRect().right)
  })
  // The card's own padding and rail, not a mark sitting at the leading edge.
  expect(gap, 'the priority mark is in the top-right corner').toBeLessThan(24)
})

test('a Done card keeps no lane-age warning', async ({ page }) => {
  await openBoard(page)
  // The seeded Done card has an arrival stamp old enough to age in any other column. Done is
  // finished, so the age cue has nothing left to ask a reader to do.
  const done = page.locator('[data-workflow="cards"] [data-card-id="st-signup-screens"]')
  await expect(done).toBeVisible()
  await expect(done.locator('[title$="days in this lane"]')).toHaveCount(0)
  await expect(done.getByText(/in lane/)).toHaveCount(0)
})

test('waiting is a warning; being waited on is not', async ({ page }) => {
  // Team Nova's identity contract blocks SSO on Team Atlas, so one card waits on it. The card
  // that is waited on wears no badge for it: the relationship is read from the card that waits,
  // in its Waiting-on chips and in the drawer.
  await openBoard(page, '/app?board=b-nova')
  const blocker = page.locator('[data-workflow="cards"] [data-card-id="st-identity-contract"]')
  await expect(blocker).toBeVisible()
  await expect(blocker).not.toContainText('depend on it')
  await expect(blocker).not.toContainText('depends on it')
})

test('a new card is selected, with its title ready to type', async ({ page }) => {
  await openBoard(page)
  const before = await page.locator('[data-workflow="cards"] [data-card-id]').count()

  await page.getByRole('button', { name: 'Add card to Backlog' }).first().click()
  const panel = page.locator('[data-item-panel]')
  await expect(panel).toBeVisible()
  const title = panel.getByLabel('Title')
  await expect(title).toBeFocused()
  await expect(title).toHaveValue('New card')

  // The placeholder is selected, so typing replaces it rather than appending to it.
  await page.keyboard.type('A fresh card')
  await expect(title).toHaveValue('A fresh card')

  await panel.getByRole('button', { name: 'Close' }).click()
  await expect(panel).toHaveCount(0)
  await expect(page.locator('[data-workflow="cards"] [data-card-id]').filter({ hasText: 'A fresh card' })).toHaveCount(1)
  await expect(page.locator('[data-workflow="cards"] [data-card-id]')).toHaveCount(before + 1)
})
