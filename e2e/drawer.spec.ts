import { expect, test, type Page } from '@playwright/test'
import { cardsIn, openBoard } from './support'

/**
 * The drawer's four edits, each asserted where it matters: **on the card**, after the drawer has
 * closed. A field that changes inside a panel and nowhere else is a field that did not change.
 */

/** Open the first card of the Backlog and answer its id. */
async function openFirstBacklogCard(page: Page): Promise<string> {
  const [id] = await cardsIn(page, 'Backlog')
  await page.locator(`[data-card-id="${id}"]`).click()
  await expect(page.getByLabel('Title')).toBeVisible()
  return id
}

const closeDrawer = (page: Page) => page.getByRole('button', { name: 'Close' }).click()
const card = (page: Page, id: string) => page.locator(`[data-card-id="${id}"]`)

test('a title edited in the drawer is the card’s title', async ({ page }) => {
  await openBoard(page)
  const id = await openFirstBacklogCard(page)

  await page.getByLabel('Title').fill('Renamed where a person renames it')
  await closeDrawer(page)

  await expect(card(page, id)).toContainText('Renamed where a person renames it')
})

test('a tag added in the drawer is on the card', async ({ page }) => {
  await openBoard(page)
  const id = await openFirstBacklogCard(page)

  const tags = page.getByLabel('Add a tag')
  await tags.fill('security')
  await tags.press('Enter')
  await closeDrawer(page)

  await expect(card(page, id)).toContainText('security')
})

test('a field is as wide as what it holds, and its chips stay inside it', async ({ page }) => {
  await openBoard(page)
  await page.locator('[data-card-id="st-payment-retries"]').click()
  const panel = page.locator('[data-item-panel]')
  await expect(panel.getByLabel('Title')).toBeVisible()

  // Type is a word, not a box: the control is no wider than its own options rather than the row.
  const type = panel.getByRole('button', { name: /^Type:/ })
  const typeBox = (await type.boundingBox())!
  expect(typeBox.width).toBeLessThan(240)

  // A day is a day: the due control is a narrow field, so its picker does not open at one edge of
  // the panel while the calendar button sits at the other.
  const due = panel.getByLabel('Due date', { exact: true })
  const dueBox = (await due.boundingBox())!
  expect(dueBox.width).toBeLessThan(240)

  // People and tags are fields: the chips live inside the well, and adding several wraps them
  // within it instead of shrinking the way to add another.
  const people = panel.locator('label', { hasText: 'People' }).locator('div').first()
  const picker = panel.getByRole('combobox', { name: 'Add a person' })
  for (let i = 0; i < 4; i++) {
    await picker.click()
    const options = panel.getByRole('listbox').getByRole('option')
    if (!(await options.count())) break
    await options.first().click()
    await page.waitForTimeout(60)
  }
  await page.keyboard.press('Escape')
  const well = (await people.boundingBox())!
  const chips = panel.locator('label', { hasText: 'People' }).locator('span[title]')
  expect(await chips.count()).toBeGreaterThan(1)
  for (const chip of await chips.all()) {
    const box = (await chip.boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(well.y - 1)
    expect(box.y + box.height).toBeLessThanOrEqual(well.y + well.height + 1)
  }
  // The picker keeps a workable width inside the field, whatever the chips do.
  expect((await picker.boundingBox())!.width).toBeGreaterThanOrEqual(100)
})

test('a due date set in the drawer is on the card, and says how late it is', async ({ page }) => {
  await openBoard(page)
  const id = await openFirstBacklogCard(page)

  // A day that has passed: the drawer records the promise, and the card is where it is read.
  // `exact` because the field also offers "Clear the due date" once it holds one.
  await page.getByLabel('Due date', { exact: true }).fill('2020-01-02')
  await closeDrawer(page)

  const chip = card(page, id).locator('[data-due="overdue"]')
  await expect(chip).toContainText('overdue')
  await expect(chip).toHaveAttribute('data-due-date', '2020-01-02')
})

test('a link set in the drawer is on the card, and opens in a new tab', async ({ page }) => {
  await openBoard(page)
  const id = await openFirstBacklogCard(page)
  // The target is never fetched by the app; the test does not fetch it either.
  await page.route('https://jira.example.com/**', (route) => route.abort())

  await page.getByLabel('External link label').fill('ATLAS-431')
  await page.getByLabel('External link URL').fill('https://jira.example.com/browse/ATLAS-431')
  await page.getByLabel('External link URL').blur()

  // An address a browser must not follow is refused where it is written, and the typed value stays
  // so a missing `https://` can be fixed in place.
  await page.getByLabel('External link URL').fill('javascript:alert(1)')
  await page.getByLabel('External link URL').blur()
  await expect(page.getByText('That is not a web address')).toBeVisible()
  await page.getByLabel('External link URL').fill('https://jira.example.com/browse/ATLAS-431')
  await page.getByLabel('External link URL').blur()
  await expect(page.getByText('That is not a web address')).toHaveCount(0)

  await closeDrawer(page)
  const chip = card(page, id).getByRole('link', { name: /ATLAS-431/ })
  await expect(chip).toHaveAttribute('href', 'https://jira.example.com/browse/ATLAS-431')
  await expect(chip).toHaveAttribute('target', '_blank')

  // The chip is a way out, not a way in: it opens the target and leaves the card closed.
  const [popup] = await Promise.all([page.waitForEvent('popup'), chip.click()])
  await popup.close()
  await expect(page.locator('[data-item-panel]')).toHaveCount(0)
})

test('the type menu shows a colour for each type, and a dash for None', async ({ page }) => {
  await openBoard(page)
  await page.locator('[data-card-id="st-usage-billing"]').click()
  const panel = page.locator('[data-item-panel]')
  const type = panel.getByRole('button', { name: /^Type:/ })

  // The chosen type's colour is on the control itself, so it reads before the menu is opened.
  await expect(type.locator('[data-type-swatch]')).toBeVisible()
  await type.click()

  const menu = panel.getByRole('listbox', { name: 'Type' })
  await expect(menu).toBeVisible()
  const story = menu.getByRole('option', { name: 'User Story' })
  await expect(story.locator('[data-type-swatch]')).toHaveAttribute('style', /background-color/)
  // None is the absence of a type, so it is a dash rather than a colour.
  await expect(menu.getByRole('option', { name: 'None' }).locator('[data-type-swatch]')).toHaveCount(0)
  await expect(menu.getByRole('option', { name: 'None' }).locator('[data-type-none]')).toBeVisible()

  // Choosing it puts the dash on the control and takes the colour away.
  await menu.getByRole('option', { name: 'None' }).click()
  await expect(type).toHaveAttribute('data-type-id', 't-none')
  await expect(type.locator('[data-type-none]')).toBeVisible()
  await expect(type.locator('[data-type-swatch]')).toHaveCount(0)
})

test('a person added in the drawer is on the card', async ({ page }) => {
  await openBoard(page)
  const id = await openFirstBacklogCard(page)

  const people = page.getByPlaceholder('Add a person…')
  await people.fill('Maya Blake')
  await people.press('Enter')
  await closeDrawer(page)

  // The card wears initials rather than names, because a card is small.
  await expect(card(page, id)).toContainText('MB')
})

test('only an existing person can be added, and the list can be clicked', async ({ page }) => {
  await openBoard(page)
  const id = await openFirstBacklogCard(page)

  const people = page.getByPlaceholder('Add a person…')
  // Typing a name nobody has is a search, not a create: Enter adds nothing.
  await people.fill('Zoe Zimmer')
  await people.press('Enter')
  await expect(page.getByText(/No one in this workspace matches/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove Zoe Zimmer' })).toHaveCount(0)

  // The list shows the person's initials, and a click on the row adds them — no keyboard step.
  await people.fill('Maya')
  const option = page.getByRole('option', { name: /Maya Blake/ })
  await expect(option).toContainText('MB')
  await option.click()
  await closeDrawer(page)

  await expect(card(page, id)).toContainText('MB')
})

test('a pip on an initiative opens the child and brings it into view', async ({ page }) => {
  // The board is taller than this viewport, so the child card starts out of sight below it.
  await page.setViewportSize({ width: 1200, height: 700 })
  await openBoard(page)

  const initiative = page.locator('[data-card-initiative]').filter({ hasText: 'Signup redesign' }).first()
  await initiative.getByRole('button', { name: 'Rebuild the signup form — In Progress' }).click()

  await expect(page.locator('[data-item-panel]')).toHaveAttribute('aria-label', 'Card details: Rebuild the signup form')

  // The pip is a way in to a card in the other workflow: the drawer opens, and the board
  // moves to the card rather than leaving the reader to find it.
  const child = page.locator('[data-workflow="cards"] [data-card-id]').filter({ hasText: 'Rebuild the signup form' }).first()
  await expect.poll(async () => {
    const box = await child.boundingBox()
    const height = page.viewportSize()?.height ?? 0
    return Boolean(box && box.y >= 0 && box.y + box.height <= height)
  }).toBe(true)
})

test('a parent set in the drawer is the card’s lineage', async ({ page }) => {
  await openBoard(page)
  const id = await openFirstBacklogCard(page)

  await page.getByRole('button', { name: 'Change parent' }).click()
  // The parent editor is the last select in the panel; the only other one is the type.
  await page.locator('select').last().selectOption({ label: 'Trial experience' })
  await page.getByRole('button', { name: 'Set parent' }).click()
  await closeDrawer(page)

  await expect(card(page, id)).toContainText('Trial experience')
})

test('the dependency picker leaves filed-away work out', async ({ page }) => {
  await openBoard(page)

  // Archive a Done card on this board first.
  await page.locator('[data-card-id="st-signup-screens"]').click()
  const panel = page.locator('[data-item-panel]')
  await panel.getByRole('button', { name: 'More', exact: true }).click()
  await panel.getByRole('button', { name: 'Archive', exact: true }).click()
  await page.keyboard.press('Escape')

  // An active card's picker does not offer it, even by its own title.
  await page.locator('[data-card-id="st-payment-retries"]').click()
  const other = page.locator('[data-item-panel]')
  await other.getByRole('button', { name: 'Hierarchy' }).click()
  await other.getByRole('button', { name: 'Add a dependency' }).click()
  const picker = page.locator('[data-item-picker]')
  await picker.getByLabel('Search items').fill('signup')
  await expect(picker.getByRole('option', { name: /Design the signup screens/ })).toHaveCount(0)
})

test('the dependency picker offers only links across the hierarchy', async ({ page }) => {
  await openBoard(page)
  // A card inside Billing migration: its own initiative is its parent, so it is not a place the
  // card can wait on, and neither is the card itself.
  await page.locator('[data-card-id="st-payment-retries"]').click()
  const panel = page.locator('[data-item-panel]')
  await expect(panel).toHaveAttribute('aria-label', 'Card details: Payment retries on soft decline')
  await panel.getByRole('button', { name: 'Hierarchy' }).click()

  await panel.getByRole('button', { name: 'Add a dependency' }).click()
  const picker = page.locator('[data-item-picker]')
  await expect(picker).toBeVisible()
  const search = picker.getByLabel('Search items')
  await expect(search).toBeFocused()

  // Escape closes the picker, not the drawer underneath it.
  await search.press('Escape')
  await expect(picker).toHaveCount(0)
  await expect(panel).toBeVisible()

  await panel.getByRole('button', { name: 'Add a dependency' }).click()
  await expect(picker).toBeVisible()

  // The list is a search, not a column of bare titles: a card is found by its title or its board.
  await search.fill('invoice')
  const option = picker.getByRole('option', { name: /Migrate invoice numbering/ })
  await expect(option).toBeVisible()
  await expect(option).toContainText('Team Atlas')

  // The parent, and the card itself, are not offered at all.
  await search.fill('')
  await expect(picker.getByRole('option', { name: /Billing migration/ })).toHaveCount(0)
  await expect(picker.getByRole('option', { name: /Payment retries on soft decline/ })).toHaveCount(0)

  await search.fill('invoice')
  await option.click()
  await expect(picker).toHaveCount(0)
  await expect(panel.getByText('Migrate invoice numbering')).toBeVisible()
})

test('an initiative opens without focusing the board; the drawer button starts it', async ({ page }) => {
  await openBoard(page)

  // A card on the same board that does not roll up to the initiative we open.
  const outsider = page.locator('[data-card-id="st-payment-retries"]')
  await expect(outsider).toHaveCount(1)
  const opacity = async () => Number(await outsider.evaluate((el) => getComputedStyle(el).opacity))
  const before = await opacity()

  await page.locator('[data-card-id="init-signup-redesign"]').click()
  const panel = page.locator('[data-item-panel]')
  await expect(panel).toBeVisible()

  // Reading the initiative leaves the board whole: focus is a mode, not a side effect.
  expect(await opacity()).toBe(before)
  const start = panel.getByTitle('Focus this line on the board')
  await expect(start).toBeVisible()

  // The drawer's own button is the way in…
  await start.click()
  await expect(panel.getByTitle('Stop focusing this line')).toBeVisible()
  // …and then the work outside the line recedes, which is what the lens is for.
  await expect.poll(opacity).toBeLessThan(before)
})

test('a card opened from a link is brought into view on the board', async ({ page }) => {
  // A short viewport: the Support band (where this card lives) starts below the fold.
  await page.setViewportSize({ width: 1200, height: 620 })
  await page.goto('/app?board=b-atlas&item=st-reproduce-report')

  const panel = page.locator('[data-item-panel]')
  await expect(panel).toHaveAttribute('aria-label', 'Card details: Reproduce the customer report')

  // The drawer is open, and the board has moved to the card rather than leaving the reader to
  // hunt for it in a band they cannot see.
  const card = page.locator('[data-workflow="cards"] [data-card-id="st-reproduce-report"]').first()
  await expect(card).toHaveCount(1)
  await expect.poll(async () => {
    const board = await page.locator('[data-board-scroll]').boundingBox()
    const box = await card.boundingBox()
    if (!board || !box) return false
    return (
      box.y >= board.y + 8 &&
      box.y + box.height <= board.y + board.height - 8 &&
      box.x >= board.x + 8 &&
      box.x + box.width <= board.x + board.width - 8
    )
  }, { timeout: 5000 }).toBe(true)
})

test('Set parent from the card menu links on a click, and does not open the drawer', async ({ page }) => {
  await openBoard(page)

  // A card whose parent is one initiative, being re-parented to another.
  await page.locator('[data-card-id="st-signup-rebuild"]').click({ button: 'right' })
  await page.locator('[data-card-menu][role="menu"]').first().getByText('Set parent…').click()
  await expect(page.locator('[data-parent-pick]')).toBeVisible()

  await page.locator('[data-card-id="init-billing"]').click()

  // The click is the answer, not a request to read the initiative: no drawer, and the pick is over.
  await expect(page.locator('[data-item-panel]')).toHaveCount(0)
  await expect(page.locator('[data-parent-pick]')).toHaveCount(0)
  // …and the card now rolls up to it.
  await expect(page.locator('[data-card-id="st-signup-rebuild"]')).toContainText('Billing migration')
})
