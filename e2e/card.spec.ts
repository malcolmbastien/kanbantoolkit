import { expect, test } from '@playwright/test'
import { openBoard } from './support'

/**
 * The card face reads top-down: what the card *is* — its type, its title, and the work it rolls up
 * to — then what it is asking a reader to look at, and finally, on one quiet rule at the foot, its
 * measurements: its sub-tasks, how long it has sat in the lane, and who has it.
 *
 * The roll-up spent a release in that foot row, where it crowded exactly the facts the row is
 * reserved for. These pin the shape, so a later tidy cannot quietly put it back.
 */

/** The face's geometry, in one measurement: what is where, and on whose row. */
async function face(page: import('@playwright/test').Page, id: string) {
  return page.locator(`[data-card-id="${id}"]`).evaluate((card) => {
    const box = (selector: string) => {
      const node = card.querySelector(selector)
      if (!node) return null
      const rect = node.getBoundingClientRect()
      return { top: Math.round(rect.top), bottom: Math.round(rect.bottom) }
    }
    return {
      // The roll-up is a door, so it is a button, and its title is what names it.
      rollup: box('button[title^="Rolls up to"]'),
      checklist: box('[title^="Checklist"]'),
      age: box('[title$="days in this lane"]'),
      people: box('[class*="-space-x-1.5"]'),
    }
  })
}

test('the roll-up reads under the title, and the foot keeps its measurements', async ({ page }) => {
  await openBoard(page)

  // The seeded card that has all of them: a parent, a checklist, a lane age and an assignee.
  const shape = await face(page, 'st-signup-rebuild')
  expect(shape.rollup, 'the roll-up is on the face').not.toBeNull()
  expect(shape.checklist, 'the card has a checklist').not.toBeNull()
  expect(shape.age, 'the card has a lane age').not.toBeNull()
  expect(shape.people, 'the card has an assignee').not.toBeNull()

  // The foot is one row: the three measurements line up with each other.
  const tops = [shape.checklist!.top, shape.age!.top, shape.people!.top]
  expect(Math.max(...tops) - Math.min(...tops), 'the foot is one row of measurements').toBeLessThanOrEqual(8)

  // …and the roll-up is above it, in the body with the title — not in the row the measurements own.
  expect(shape.rollup!.bottom, 'the roll-up sits above the foot row').toBeLessThanOrEqual(Math.min(...tops))
})

test('the roll-up opens the card it names, and not the card it sits on', async ({ page }) => {
  await openBoard(page)
  const card = page.locator('[data-card-id="st-signup-rebuild"]')
  const rollup = card.locator('button[title^="Rolls up to"]')
  const parent = (await rollup.innerText()).trim()
  expect(parent).not.toBe('')

  await rollup.click()
  // The parent's drawer, not this card's: the lineage is the way to what it names.
  await expect(page.locator('[data-item-panel]')).toHaveAttribute('aria-label', `Card details: ${parent}`)
})
