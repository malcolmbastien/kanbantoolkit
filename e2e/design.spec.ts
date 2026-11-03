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
    return { devRight: Math.round(a.right), testLeft: Math.round(b.left) }
  })
  expect(cells, 'both cells of the split are on the board').not.toBeNull()
  expect(cells!.testLeft, 'the cells are apart, so neither reads as part of the other').toBeGreaterThan(cells!.devRight)
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

  // A team board has the identity, its card vocabulary, its labels and its workflow.
  await expect(dialog.getByRole('tab')).toHaveText(['General', 'Cards', 'Labels', 'Workflow'])
  await expect(dialog.getByLabel('Title')).toBeVisible()

  // Arrow keys move between tabs, and the panel behind the selected tab is the one on screen.
  await dialog.getByRole('tab', { name: 'General' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(dialog.getByRole('tab', { name: 'Cards' })).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.getByPlaceholder('Define a new card type…')).toBeVisible()

  // End goes to the last section, whose controls are the workflow's.
  await page.keyboard.press('End')
  await expect(dialog.getByRole('tab', { name: 'Workflow' })).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.getByText('WIP limit enforcement', { exact: true })).toBeVisible()

  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(dialog).toHaveCount(0)
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

test('a board type is shown but cannot be changed in settings', async ({ page }) => {
  await openBoard(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.locator('[data-board-settings]')
  await expect(dialog).toBeVisible()

  const band = dialog.locator('[data-board-band-fixed]')
  await expect(band).toContainText('Team')
  await expect(band).toContainText('Fixed when the board was made')
  // No band chooser, and no warning-and-proceed path either.
  await expect(dialog.getByRole('button', { name: 'Program', exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Portfolio', exact: true })).toHaveCount(0)
  await expect(dialog).toContainText('To change it, make a board of the other type')
})
