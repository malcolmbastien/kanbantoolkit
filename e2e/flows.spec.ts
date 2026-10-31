import { expect, test, type Page } from '@playwright/test'
import { cardsIn, flowBand, lane, openBoard } from './support'

/**
 * A board's cards flows.
 *
 * The demo's Team Atlas carries two — the team's own "Cards" and a "Support" queue — and they are
 * stacked the way the board's flows are: each with its own header, its own count, and its own
 * design controls in edit mode. Nothing is hidden behind a tab, so a card crossing flows is a drag
 * between two visible trees.
 */

const editBoard = (page: Page) => page.getByRole('button', { name: 'Edit board' }).click()
const saveBoard = (page: Page) => page.getByRole('button', { name: 'Save' }).click()
const bands = (page: Page) => page.locator('[data-flow-band]')
const band = (page: Page, name: string) => flowBand(page, name)
const flowNames = (page: Page) =>
  bands(page).evaluateAll((elements) => elements.map((el) => (el as HTMLElement).dataset.flowName ?? ''))
const addFlow = (page: Page) => page.getByRole('button', { name: 'Add a cards flow' }).click()
const renameInput = (page: Page, name: string) => page.getByRole('button', { name: `Rename ${name}` })

/** Rename a flow from its header. The name is the control in edit mode. */
async function rename(page: Page, from: string, to: string): Promise<void> {
  await renameInput(page, from).click()
  await page.getByRole('textbox', { name: `Rename ${from}` }).fill(to)
  await page.keyboard.press('Enter')
}

test('the demo ships a board with two cards flows, and they read apart', async ({ page }) => {
  await openBoard(page)

  // Team Atlas carries its own flow and a support queue: two bands, in the board's order.
  expect(await flowNames(page)).toEqual(['Cards', 'Support'])
  // The support queue holds real work, in its own columns, without editing anything.
  expect(await cardsIn(page, 'Backlog', 'Support')).toEqual(['st-triage-request'])
  expect(await cardsIn(page, 'In Progress', 'Support')).toEqual(['st-reproduce-report'])
  expect(await cardsIn(page, 'Done', 'Support')).toEqual(['st-answer-customer'])
  // And the team's own flow is untouched by it: its Backlog is another set of cards.
  expect(await cardsIn(page, 'Backlog', 'Cards')).not.toContain('st-triage-request')
})

test('a one-flow board is the band it always was — no tabs, one header', async ({ page }) => {
  await openBoard(page, '/app?board=b-nova')

  await expect(bands(page)).toHaveCount(1)
  await expect(band(page, 'Cards')).toBeVisible()
  await expect(page.getByRole('tablist')).toHaveCount(0)
})

test('a new flow is another band, with its own name, count and columns', async ({ page }) => {
  await openBoard(page)
  await editBoard(page)
  await addFlow(page)
  await rename(page, 'Cards 2', 'Escalations')
  await saveBoard(page)

  // Three bands, stacked in the board's order, each a tree of its own.
  await expect(bands(page)).toHaveCount(3)
  expect(await flowNames(page)).toEqual(['Cards', 'Support', 'Escalations'])
  for (const column of ['Backlog', 'Not Started', 'In Progress', 'Done']) {
    await expect(lane(page, column, 'Escalations')).toBeVisible()
  }
  // The new flow is empty; the team's own cards are still where they were.
  expect(await cardsIn(page, 'Backlog', 'Escalations')).toEqual([])
  expect((await cardsIn(page, 'Backlog', 'Cards')).length).toBeGreaterThan(0)
})

test('a flow is named and placed from its header, and only in edit mode', async ({ page }) => {
  await openBoard(page)
  await editBoard(page)
  await addFlow(page)
  await rename(page, 'Cards 2', 'Escalations')

  // Place is the header's too: the bands are vertical, so it is up and down.
  await band(page, 'Escalations').getByRole('button', { name: 'Move Escalations up' }).click()
  expect(await flowNames(page)).toEqual(['Cards', 'Escalations', 'Support'])
  await saveBoard(page)
  expect(await flowNames(page)).toEqual(['Cards', 'Escalations', 'Support'])

  // Readers get the bands, not the design controls.
  await expect(page.getByRole('button', { name: 'Add a cards flow' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Move Escalations up' })).toHaveCount(0)
})

test('a flow that holds nothing can be removed, and the last one cannot', async ({ page }) => {
  await openBoard(page)
  await editBoard(page)
  await addFlow(page)
  await rename(page, 'Cards 2', 'Spike')
  await saveBoard(page)
  await expect(bands(page)).toHaveCount(3)

  await editBoard(page)
  // An occupied flow cannot go — and the button says which refusal it is: work, not the floor.
  await expect(band(page, 'Cards').getByRole('button', { name: 'Remove Cards' })).toBeDisabled()
  await expect(band(page, 'Cards').getByRole('button', { name: 'Remove Cards' })).toHaveAttribute(
    'title',
    /still holds cards/,
  )
  await band(page, 'Spike').getByRole('button', { name: 'Remove Spike' }).click()
  await page.getByRole('button', { name: 'Remove flow' }).click()
  await saveBoard(page)
  await expect(bands(page)).toHaveCount(2)
  // The demo's two flows are their own; one of them still cannot go while it holds its cards.
  await editBoard(page)
  await expect(band(page, 'Support').getByRole('button', { name: 'Remove Support' })).toBeDisabled()
  await expect(band(page, 'Support').getByRole('button', { name: 'Remove Support' })).toHaveAttribute(
    'title',
    /still holds cards/,
  )

  // A board with one cards flow says the other reason: the floor, not the work.
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.goto('/app?board=b-nova')
  await editBoard(page)
  await expect(band(page, 'Cards').getByRole('button', { name: 'Remove Cards' })).toBeDisabled()
  await expect(band(page, 'Cards').getByRole('button', { name: 'Remove Cards' })).toHaveAttribute(
    'title',
    /at least one cards flow/,
  )
})

test('a card crosses flows by being dragged between two bands', async ({ page }) => {
  // Both bands on screen: a stacked board is taller than a tabbed one, and a drag is a pointer
  // gesture over what is visible.
  await page.setViewportSize({ width: 1400, height: 2200 })
  await openBoard(page)

  const [card] = await cardsIn(page, 'Backlog', 'Cards')
  expect(card).toBeTruthy()
  const source = await page.locator(`[data-card-id="${card}"]`).boundingBox()
  const target = await lane(page, 'Backlog', 'Support').boundingBox()
  if (!source || !target) throw new Error('nothing to drag')

  // No tab to rest on: both trees are on screen, so this is a plain drop into the other band.
  await page.mouse.move(source.x + source.width / 2, source.y + 18)
  await page.mouse.down()
  await page.mouse.move(target.x + target.width / 2, target.y + target.height - 8, { steps: 12 })

  // The shadow of the card in the air is in the lane it would land in — the *other* flow's lane —
  // and only there. Without a shared preview, the target tree had nothing to draw.
  await expect(band(page, 'Support').locator('[data-drop-placeholder]')).toHaveCount(1)
  await expect(band(page, 'Cards').locator('[data-drop-placeholder]')).toHaveCount(0)

  await page.mouse.up()

  await expect.poll(() => cardsIn(page, 'Backlog', 'Support')).toContain(card)
  expect(await cardsIn(page, 'Backlog', 'Cards')).not.toContain(card)
})

test('the card menu names the flows, and its move lands in the one chosen', async ({ page }) => {
  await openBoard(page)
  await editBoard(page)
  await addFlow(page)
  await rename(page, 'Cards 2', 'Escalations')
  await saveBoard(page)

  const [card] = await cardsIn(page, 'Backlog', 'Cards')
  await page.locator(`[data-card-id="${card}"]`).click({ button: 'right' })
  const menu = page.locator('[data-card-menu][role="menu"]').first()
  // The sub-menu opens on hover; a click toggles it shut again.
  await menu.getByRole('button', { name: 'Move to lane' }).hover()

  // Three flows, three Backlogs: the destination is named by its flow.
  const flyout = page.locator('[data-card-flyout]')
  await expect(flyout.getByRole('group', { name: 'Escalations' })).toBeVisible()
  await flyout.getByRole('group', { name: 'Escalations' }).getByRole('button', { name: 'Backlog' }).click()

  await expect.poll(() => cardsIn(page, 'Backlog', 'Escalations')).toContain(card)
})

test('a board-wide default is where a new card lands, whichever flow names it', async ({ page }) => {
  await openBoard(page)
  await editBoard(page)
  await addFlow(page)
  await rename(page, 'Cards 2', 'Escalations')
  await saveBoard(page)

  // The board says new cards land in Escalations' Not Started — one cell, naming a flow.
  await page.getByRole('button', { name: 'Settings' }).click()
  const value = await page.locator('#board-default-drop optgroup[label="Escalations"] option').nth(1).getAttribute('value')
  await page.locator('#board-default-drop').selectOption(value!)
  await page.keyboard.press('Escape')

  const onCards = await cardsIn(page, 'Backlog', 'Cards')
  await page.getByRole('button', { name: 'Card', exact: true }).click()
  await expect.poll(() => cardsIn(page, 'Not Started', 'Escalations')).toHaveLength(1)
  // The other flows did not grow: the default is the board's answer, not the first flow's.
  expect(await cardsIn(page, 'Backlog', 'Cards')).toEqual(onCards)
})

test('the dashboard reads every flow, one group at a time', async ({ page }) => {
  await openBoard(page)
  await editBoard(page)
  await addFlow(page)
  await rename(page, 'Cards 2', 'Escalations')
  await saveBoard(page)

  await page.getByRole('button', { name: 'Dashboard' }).click()
  // "Time in column" is per flow: the same four column names would otherwise be four answers.
  const section = page.locator('section').filter({ hasText: 'Time in column' })
  for (const name of ['Cards', 'Support', 'Escalations']) {
    await expect(section.getByRole('heading', { name, exact: true })).toBeVisible()
  }
})

test('a card finished in a second flow is archived as completed', async ({ page }) => {
  await openBoard(page)
  await editBoard(page)
  await addFlow(page)
  await rename(page, 'Cards 2', 'Escalations')
  await saveBoard(page)

  // The card finishes in the third flow's Done column — the menu is the deterministic door.
  const card = 'st-usage-billing'
  await page.locator(`[data-card-id="${card}"]`).click({ button: 'right' })
  const menu = page.locator('[data-card-menu][role="menu"]').first()
  await menu.getByRole('button', { name: 'Move to lane' }).hover()
  await page.locator('[data-card-flyout]').getByRole('group', { name: 'Escalations' }).getByRole('button', { name: 'Done' }).click()

  // Filed away from the card's own panel: it is Done, so the word is Archive.
  await page.locator(`[data-card-id="${card}"]`).click()
  const panel = page.locator('[data-item-panel]')
  await panel.getByRole('button', { name: /More — duplicate/ }).click()
  await panel.getByRole('button', { name: 'Archive', exact: true }).click()

  // The archive keeps one fact about it: the work was finished, in whichever flow it finished.
  await page.goto('/app?board=b-atlas&view=archive')
  const row = page.locator('tr', { hasText: 'Add usage-based billing events' })
  await expect(row).toBeVisible()
  await expect(row.getByText('Completed')).toBeVisible()
  await expect(row.getByText('Discarded')).toHaveCount(0)
})

test('workflow headers stay in view while their columns scroll', async ({ page }) => {
  await openBoard(page)
  const scroller = page.locator('[data-board-scroll]')
  const cards = flowBand(page, 'Cards')
  const cardsHeader = cards.locator(':scope > div').first()
  const initiativesHeader = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Initiatives workflow' }) })
    .locator(':scope > div')
    .first()
  const boundaryHeader = page.locator('[data-workflow="boundary"] > div').first()

  for (const header of [initiativesHeader, cardsHeader, boundaryHeader]) {
    expect(await header.evaluate((element) => getComputedStyle(element).position)).toBe('sticky')
  }

  // Scroll just inside the Cards band: its own header has passed the top, so it should be held
  // there rather than disappearing behind the initiatives above it.
  const offsets = await cards.evaluate((section) => {
    const box = section.closest('[data-board-scroll]') as HTMLElement
    const header = section.firstElementChild as HTMLElement
    return {
      top: box.scrollTop + header.getBoundingClientRect().top - box.getBoundingClientRect().top,
      height: section.getBoundingClientRect().height,
      headerHeight: header.getBoundingClientRect().height,
    }
  })
  expect(offsets.height, 'the Cards band is tall enough to scroll inside').toBeGreaterThan(offsets.headerHeight + 80)
  await scroller.evaluate((element, top) => {
    element.scrollTop = top
  }, offsets.top + 60)

  const held = await cardsHeader.evaluate((header) => {
    const box = header.closest('[data-board-scroll]')
    if (!box) return Number.NaN
    return Math.round(header.getBoundingClientRect().top - box.getBoundingClientRect().top)
  })
  // The board scroller has p-4, so its content box starts 16px below the scroller's edge.
  expect(held, 'the Cards header is held at the top of the scroller').toBeGreaterThanOrEqual(-1)
  expect(held).toBeLessThanOrEqual(20)
})


test('a cards flow keeps the board margin without a second inset', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 1100 })
  await openBoard(page)
  const cards = flowBand(page, 'Cards')
  const initiatives = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Initiatives workflow' }) })
    .first()
  const canvas = cards.locator('[data-workflow="cards"] > div').first()
  const [cardsBox, initiativesBox, canvasBox] = await Promise.all([
    cards.boundingBox(),
    initiatives.boundingBox(),
    canvas.boundingBox(),
  ])
  expect(cardsBox).toBeTruthy()
  expect(initiativesBox).toBeTruthy()
  expect(canvasBox).toBeTruthy()
  // One margin for every band; the cards canvas gives it no second inset of its own.
  expect(Math.round(cardsBox!.x)).toBe(Math.round(initiativesBox!.x))
  expect(Math.round(canvasBox!.x)).toBe(Math.round(cardsBox!.x))
  expect(Math.round(canvasBox!.width)).toBe(Math.round(cardsBox!.width))
  expect(await canvas.evaluate((element) => getComputedStyle(element).paddingLeft)).toBe('0px')
  expect(await canvas.evaluate((element) => getComputedStyle(element).paddingRight)).toBe('0px')
})
