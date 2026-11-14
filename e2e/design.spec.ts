import { expect, test, type Page } from '@playwright/test'
import { cardsIn, dropAtEnd, lane, laneRegion, openBoard } from './support'

/**
 * Board design: the work is done in edit mode, and the draft only becomes the board on Save. So
 * each test saves before it asserts — the claim is about the board, not about the draft.
 */

const editBoard = (page: Page) => page.getByRole('button', { name: 'Edit board' }).click()
const saveBoard = (page: Page) => page.getByRole('button', { name: 'Save' }).click()
const splitIntoColumns = (page: Page, name: string) =>
  laneRegion(page, name).getByRole('button', { name: 'Split this cell into columns' }).click()
/**
 * The Add control belongs to the *container*, and only a leaf cell is a named region — so this is
 * found by its own title, and takes the first one, which is the Backlog split.
 */
const addColumn = (page: Page) =>
  page.getByRole('button', { name: 'Add a column to this split' }).first().click()

test('an open board design closes the board switcher and asks before leaving for home', async ({ page }) => {
  await openBoard(page)
  await editBoard(page)

  // The switcher is present but closed: another board cannot be opened around an unsaved design.
  const switcher = page.getByRole('button', { name: /Team Atlas/ })
  await expect(switcher).toBeDisabled()

  // The workspace link is still a way out, but it asks first and leaves the draft untouched on
  // Cancel.
  await page.getByTitle('Workspace home').click()
  const dialog = page.getByRole('dialog', { name: 'Leave design?' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Unsaved changes')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible()

  // Confirming discards the draft and opens the workspace home.
  await page.getByTitle('Workspace home').click()
  await dialog.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(page.getByRole('tablist', { name: 'Workspace home sections' })).toBeVisible()
})

test('a column header is a shelf over its lane, and a split’s cells stand apart', async ({ page }) => {
  await openBoard(page)

  // The header is not a card: translucent ground, no shadow. A repeated bar that wore the card's
  // treatment competed with the work; one with no ground at all vanished into the lane's tint.
  const header = page.getByText('Dev', { exact: true }).first()
  const look = await header.evaluate((name) => {
    let node: HTMLElement | null = name as HTMLElement
    while (node && getComputedStyle(node).backgroundColor === 'rgba(0, 0, 0, 0)') node = node.parentElement
    if (!node) return null
    const style = getComputedStyle(node)
    return { background: style.backgroundColor, shadow: style.boxShadow }
  })
  expect(look, 'the header has a ground of its own').not.toBeNull()
  // Browsers report the computed colour in their own space; what matters is that it is a wash
  // (some ground, some transparency) rather than a plate or nothing at all.
  const alpha = Number(look!.background.match(/\/\s*([\d.]+)\)$/)?.[1] ?? '1')
  expect(look!.background, 'the header has a ground').not.toBe('rgba(0, 0, 0, 0)')
  expect(alpha, 'a wash, not an opaque plate').toBeGreaterThan(0)
  expect(alpha).toBeLessThan(1)
  expect(look!.shadow, 'no shadow: cards are the only plane that lifts').toBe('none')

  // Two cells of one split are separated by air, not drawn through by a rule, and each header
  // carries its own name so a reader can tell which side of the split a card belongs to.
  const cells = await page.evaluate(() => {
    const cellFor = (label: string) => {
      const name = [...document.querySelectorAll('span')].find((s) => s.textContent?.trim() === label)
      return name?.closest('[data-lane-cell]') as HTMLElement | null
    }
    const dev = cellFor('Dev')
    const test = cellFor('Test')
    if (!dev || !test) return null
    const a = dev.getBoundingClientRect()
    const b = test.getBoundingClientRect()
    return { devRight: Math.round(a.right), testLeft: Math.round(b.left), devWidth: Math.round(a.width), testWidth: Math.round(b.width) }
  })
  expect(cells, 'both cells of the split are on the board').not.toBeNull()
  expect(cells!.testLeft, 'the cells are apart, so neither reads as part of the other').toBeGreaterThan(cells!.devRight)
  // Siblings share the column equally, whatever their cards happen to say.
  expect(Math.abs(cells!.devWidth - cells!.testWidth), 'the split cells are equal').toBeLessThanOrEqual(1)
})

test('splitting a cell gives it the columns it promised, and the cards move into the first', async ({ page }) => {
  await openBoard(page)
  const cards = await cardsIn(page, 'Backlog')

  await editBoard(page)
  await splitIntoColumns(page, 'Backlog')
  await saveBoard(page)

  // The cell is now a container of two, and its cards are in the first of them.
  // The split happened in the board's own flow; the demo also carries a support queue, whose
  // lanes are not this count.
  await expect(page.locator('[data-flow-band]').first().locator('[data-workflow="cards"] [data-lane-id]')).toHaveCount(6)
  expect(await cardsIn(page, 'Column 1')).toEqual(cards)
})

test('a cell added to a split accepts a card', async ({ page }) => {
  await openBoard(page)
  const [moved] = await cardsIn(page, 'Backlog')

  await editBoard(page)
  await splitIntoColumns(page, 'Backlog')
  await addColumn(page)
  await saveBoard(page)

  // Column 3 is a real cell: a card dropped into it stays.
  await expect(lane(page, 'Column 3')).toBeVisible()
  await dropAtEnd(page, moved, 'Column 3')
  await expect.poll(() => cardsIn(page, 'Column 3')).toEqual([moved])
})

test('a cell that holds cards cannot be removed, and an empty one moves nothing', async ({ page }) => {
  await openBoard(page)
  const cards = await cardsIn(page, 'Backlog')

  await editBoard(page)
  await splitIntoColumns(page, 'Backlog')
  await addColumn(page)
  await saveBoard(page)
  // Splitting moved the cards into Column 1; put one in Column 3 so the third cell is occupied.
  const [moved] = cards
  await dropAtEnd(page, moved, 'Column 3')
  await expect.poll(() => cardsIn(page, 'Column 3')).toEqual([moved])

  // The occupied cell is refused, and says why: deletion never moves work.
  await editBoard(page)
  await laneRegion(page, 'Column 3')
    .getByRole('button', { name: /Name, WIP limit and policy/ })
    .click()
  await expect(page.getByRole('button', { name: 'Remove lane' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Remove lane' })).toHaveAttribute('title', /holds cards/)
  await page.keyboard.press('Escape')

  // The empty cell may go — and because Column 1 still holds cards, the split is not folded over
  // them: the cards stay exactly where they were.
  await laneRegion(page, 'Column 2')
    .getByRole('button', { name: /Name, WIP limit and policy/ })
    .click()
  await page.getByRole('button', { name: 'Remove lane' }).click()
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Remove lane' }).click()
  await saveBoard(page)

  await expect(lane(page, 'Column 2')).toHaveCount(0)
  await expect(lane(page, 'Column 1')).toBeVisible()
  expect(await cardsIn(page, 'Column 1')).toEqual(cards.filter((id) => id !== moved))
  expect(await cardsIn(page, 'Column 3')).toEqual([moved])
})

test('the design controls are not on the working board', async ({ page }) => {
  await openBoard(page)
  const split = page.getByRole('button', { name: 'Split this cell into columns' })

  await expect(split).toHaveCount(0)
  await editBoard(page)
  expect(await split.count()).toBeGreaterThan(0)
  await saveBoard(page)
  await expect(split).toHaveCount(0)
})

test('board settings is a tabbed modal, and its tabs work from the keyboard', async ({ page }) => {
  await openBoard(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.locator('[data-board-settings]')
  await expect(dialog).toBeVisible()

  // A team board has its identity and its policies on General, its card vocabulary on Cards, and
  // its tags on their own tab — one tab per kind of question, and the board's type is not one.
  await expect(dialog.getByRole('tab')).toHaveText(['General', 'Cards', 'Tags'])
  await expect(dialog.getByLabel('Title')).toBeVisible()
  // How the board treats a full column is General's, and so is turning it into a template.
  await expect(dialog.getByLabel('WIP limit enforcement')).toBeVisible()
  await expect(dialog.getByRole('button', { name: /Save as template/ })).toBeVisible()

  // Arrow keys move between tabs, and the panel behind the selected tab is the one on screen.
  await dialog.getByRole('tab', { name: 'General' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(dialog.getByRole('tab', { name: 'Cards' })).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.getByPlaceholder('Define a new card type…')).toBeVisible()
  // The initiative kinds live with the types; the tags have a tab of their own, so the cards
  // panel says nothing about them (the panel is in the DOM either way, hidden).
  const cardsPanel = dialog.locator('#board-settings-panel-cards')
  await expect(cardsPanel.getByText('Initiative kinds', { exact: true })).toBeVisible()
  await expect(cardsPanel.getByText('Tags', { exact: true })).toHaveCount(0)

  // End goes to the last tab, which is the tags' own list.
  await page.keyboard.press('End')
  await expect(dialog.getByRole('tab', { name: 'Tags' })).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.locator('#board-settings-panel-tags').getByPlaceholder('Define a new tag…')).toBeVisible()

  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(dialog).toHaveCount(0)
})

test('a new type and kind start from colours the vocabulary is not using', async ({ page }) => {
  await openBoard(page)
  const palette = await page.evaluate(() => {
    const raw = localStorage.getItem('kanbantoolkit-state-v3')
    if (!raw) return { types: [], kinds: [] }
    const parsed = JSON.parse(raw) as { state?: Record<string, unknown> }
    const state = (parsed.state ?? parsed) as {
      issueTypes: Array<{ color: string }>
      boards: Array<{ id: string; initiativeTypes?: Array<{ color: string }> }>
    }
    return {
      types: state.issueTypes.map((type) => type.color.toLowerCase()),
      kinds: (state.boards.find((board) => board.id === 'b-portfolio')?.initiativeTypes ?? []).map((kind) =>
        kind.color.toLowerCase(),
      ),
    }
  })

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.locator('[data-board-settings]')
  await dialog.getByRole('tab', { name: 'Cards', exact: true }).click()

  const typeColour = (title: string) => dialog.getByTitle(title).inputValue()
  const newType = await typeColour('New type colour')
  expect(palette.types).not.toContain(newType)

  // Once a colour is spent, the next new type starts from the next free one.
  await dialog.getByPlaceholder('Define a new card type…').fill('Colour probe')
  await dialog.getByRole('button', { name: 'Add type' }).click()
  await expect(dialog.getByText('Colour probe').first()).toBeVisible()
  await expect.poll(() => typeColour('New type colour')).not.toBe(newType)
  const nextType = await typeColour('New type colour')
  expect(palette.types).not.toContain(nextType)
  await page.keyboard.press('Escape')

  // Kinds are per board: the Growth value stream defines Workstream and Enabler.
  await page.goto('/app?board=b-portfolio')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const kinds = page.locator('[data-board-settings]')
  await kinds.getByRole('tab', { name: 'Cards', exact: true }).click()
  expect(palette.kinds).not.toContain(await kinds.getByTitle('New kind colour').inputValue())
})

test('a workflow can carry an optional sub-header, written in edit mode', async ({ page }) => {
  await openBoard(page)
  await editBoard(page)

  const initiatives = page.getByRole('textbox', { name: 'Initiatives description' })
  const cards = page.getByRole('textbox', { name: 'Cards description' })
  await expect(initiatives).toHaveAttribute('placeholder', 'Describe this workflow (optional)')
  await initiatives.fill('Where the bets live.')
  await cards.fill('Delivery, from idea to done.')
  await saveBoard(page)

  // Read mode shows the board's own line, and nothing when it has none.
  await expect(page.getByText('Where the bets live.')).toBeVisible()
  await expect(page.getByText('Delivery, from idea to done.')).toBeVisible()

  // It is design, not view state: a reload still has it.
  await page.reload()
  await expect(page.getByText('Where the bets live.')).toBeVisible()

  // Clearing one line leaves the other, and leaves no empty line behind.
  await editBoard(page)
  await page.getByRole('button', { name: 'Clear Initiatives description' }).click()
  await saveBoard(page)
  await expect(page.getByText('Where the bets live.')).toHaveCount(0)
  await expect(page.getByText('Delivery, from idea to done.')).toBeVisible()
})

test('a board type is named, never offered as a setting', async ({ page }) => {
  await openBoard(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.locator('[data-board-settings]')
  await expect(dialog).toBeVisible()

  // The dialog's header names the board's type. General does not repeat it as a field, and there is
  // no chooser and no warning-and-proceed path either: a type fixed at creation is not a setting.
  await expect(dialog.getByText('Team', { exact: true })).toHaveCount(1)
  await expect(dialog).not.toContainText('Flight-level')
  await expect(dialog.getByRole('button', { name: 'Program', exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Portfolio', exact: true })).toHaveCount(0)
  await expect(dialog.locator('[data-board-band-fixed]')).toHaveCount(0)
})

test('a folded column at any depth is a strip, and its outline is not clipped', async ({ page }) => {
  await openBoard(page)

  const fold = (name: string) => laneRegion(page, name).getByTitle('Collapse column').click()
  const strip = (name: string) => page.locator('[role="treeitem"][aria-expanded="false"]').filter({ hasText: name })

  // A top-level column folds to a 36px rail. Its wrapper must not round or clip the rail's own
  // outline: the blue border of Not Started used to be cut at the corners.
  await fold('Not Started')
  const notStarted = strip('Not Started')
  await expect(notStarted).toBeVisible()
  const top = await notStarted.evaluate((el) => {
    const box = el.getBoundingClientRect()
    const wrapper = el.parentElement
    return {
      width: box.width,
      radius: wrapper ? getComputedStyle(wrapper).borderRadius : '',
      overflow: wrapper ? getComputedStyle(wrapper).overflow : '',
    }
  })
  expect(top.width).toBeLessThan(50)
  expect(top.radius).toBe('0px')
  expect(top.overflow).toBe('visible')

  // Dev is a cell of a columns-split inside In Progress, and it folds now too. The rail keeps its
  // 36px width but sits inset from the parent column, so the parent's rounded overflow cannot
  // shave its outline.
  await fold('Dev')
  const dev = strip('Dev')
  await expect(dev).toBeVisible()
  expect((await dev.boundingBox())!.width).toBeLessThan(50)
  const inside = await dev.evaluate((el) => {
    const parent = el.closest('[role="treeitem"][aria-expanded="true"]')
    if (!parent) return null
    const rail = el.getBoundingClientRect()
    const column = parent.getBoundingClientRect()
    return { left: rail.left - column.left, right: column.right - rail.right }
  })
  expect(inside).not.toBeNull()
  expect(inside!.left).toBeGreaterThanOrEqual(5)
  expect(inside!.right).toBeGreaterThanOrEqual(5)
  await expect(laneRegion(page, 'Dev')).toHaveCount(0)
})

test('a folded column keeps its stage header when it expands again', async ({ page }) => {
  await openBoard(page)
  const header = (locator: ReturnType<typeof page.locator>) => locator.locator('[data-lane-header]').first()

  // The initiatives flow: In Progress wears violet.
  const initiatives = page.locator('[data-workflow="initiatives"]')
  const initiativeColumn = () => initiatives.locator('[data-section-id]').filter({ hasText: 'IN PROGRESS' }).first()
  await expect(header(initiativeColumn())).toHaveClass(/bg-violet-600/)
  await initiativeColumn().getByTitle('Collapse column').first().click()
  await expect(initiatives.getByTitle('Expand').first()).toBeVisible()
  await initiatives.getByTitle('Expand').first().click()
  await expect(header(initiativeColumn())).toHaveClass(/bg-violet-600/)

  // The cards flow uses the same stage header on its top-level columns.
  const cards = page.locator('[data-flow-band]').first()
  const cardColumn = () =>
    cards
      .locator('[role="treeitem"][aria-level="2"]:not([data-lane-cell])')
      .filter({ hasText: 'IN PROGRESS' })
      .first()
  await expect(header(cardColumn())).toHaveClass(/bg-violet-600/)
  await cardColumn().getByTitle('Collapse column').first().click()
  await expect(cards.getByTitle('Expand').first()).toBeVisible()
  await cards.getByTitle('Expand').first().click()
  await expect(header(cardColumn())).toHaveClass(/bg-violet-600/)
})

test('the fold and policy controls have usable hit targets', async ({ page }) => {
  await openBoard(page)
  const size = async (locator: ReturnType<typeof page.locator>) => {
    const box = await locator.first().boundingBox()
    expect(box, 'the control is on the board').not.toBeNull()
    return Math.min(box!.width, box!.height)
  }

  // A 16px chevron is a decoration, not a target: a column's fold, a workflow's fold and the
  // lane-policy info all clear a 24px square.
  expect(await size(page.getByTitle('Collapse column'))).toBeGreaterThanOrEqual(24)
  expect(await size(page.getByRole('button', { name: /^Collapse Cards/ }))).toBeGreaterThanOrEqual(24)
  expect(await size(page.getByRole('button', { name: 'Lane policy' }))).toBeGreaterThanOrEqual(24)

  // The folded rail's expand control is the only way back, so it is a real target too.
  await page.getByTitle('Collapse column').first().click()
  expect(await size(page.getByTitle('Expand'))).toBeGreaterThanOrEqual(24)
})
