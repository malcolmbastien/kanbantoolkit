import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

/**
 * The workspace home's two shortcuts (task 200).
 *
 * The home is one flat grid of every board. Above it, a person keeps the boards they use every day
 * and finds the ones they were in lately. Both are this browser's, so they survive a reload and a
 * static build has them without any server at all.
 */

const HOME = '/app?view=boards'

const opened = async (page: Page): Promise<void> => {
  // A board can carry more than one cards flow; the first one drawing is the board being open.
  await expect(page.locator('[data-workflow="cards"]').first()).toBeVisible()
}

test('a board is kept on the home, survives a reload, and makes way for a search', async ({ page }) => {
  await page.goto(HOME)
  await expect(page.getByRole('heading', { name: 'Workspace Home' })).toBeVisible()

  const star = page.getByRole('button', { name: 'Add Team Atlas to favourites' })
  await expect(star).toHaveAttribute('aria-pressed', 'false')

  // The star is reachable and toggles without opening the board.
  await star.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/view=boards/)
  await expect(page.getByRole('button', { name: 'Remove Team Atlas from favourites' }).first()).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  const favourites = page.locator('[data-favourites]')
  await expect(favourites).toBeVisible()
  await expect(favourites).toContainText('Team Atlas')

  await page.reload()
  await expect(page.locator('[data-favourites]')).toContainText('Team Atlas')

  // A search asks about the whole list, and the Templates tab is a different list: the shortcuts
  // stand aside for both.
  await page.getByLabel('Search boards').fill('nova')
  await expect(page.locator('[data-favourites]')).toHaveCount(0)
  await expect(page.locator('[data-recent-boards]')).toHaveCount(0)
  await page.getByLabel('Search boards').fill('')
  await page.getByRole('tab', { name: /Templates/ }).click()
  await expect(page.locator('[data-favourites]')).toHaveCount(0)
  await page.getByRole('tab', { name: /Boards/ }).click()
  await expect(page.locator('[data-favourites]')).toContainText('Team Atlas')

  // Taking it off from the row leaves no empty box behind.
  await page.locator('[data-favourites]').getByRole('button', { name: 'Remove Team Atlas from favourites' }).click()
  await expect(page.locator('[data-favourites]')).toHaveCount(0)
})

test('a board opened is recent, newest first, and a favourite is not repeated', async ({ page }) => {
  await page.goto(HOME)

  await page.getByRole('button', { name: 'Team Nova', exact: true }).click()
  await opened(page)
  await page.goto(HOME)
  await page.getByRole('button', { name: 'Team Atlas', exact: true }).click()
  await opened(page)
  await page.goto(HOME)

  const recent = page.locator('[data-recent-boards]')
  await expect(recent).toBeVisible()
  const order = await recent
    .locator('[data-board-shortcut]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-board-shortcut')))
  expect(order.slice(0, 2)).toEqual(['b-atlas', 'b-nova'])

  // The newest board joins the favourites, and the recent row does not say it twice.
  await page.getByRole('button', { name: 'Add Team Atlas to favourites' }).click()
  await expect(page.locator('[data-favourites]')).toContainText('Team Atlas')
  await expect(page.locator('[data-recent-boards]')).not.toContainText('Team Atlas')
  await expect(page.locator('[data-recent-boards]')).toContainText('Team Nova')
})

test('the home with both rows and the stars has no barrier a machine can find', async ({ page }) => {
  await page.goto(HOME)
  await page.getByRole('button', { name: 'Add Team Atlas to favourites' }).click()
  await page.getByRole('button', { name: 'Team Nova', exact: true }).click()
  await opened(page)
  await page.goto(HOME)
  await expect(page.locator('[data-favourites]')).toBeVisible()
  await expect(page.locator('[data-recent-boards]')).toBeVisible()
  await page.getByRole('button', { name: 'More for Team Atlas' }).click()
  await expect(page.getByText('Duplicate', { exact: true })).toBeVisible()

  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(
    violations
      .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
      .map(
        (violation) =>
          `${violation.id} (${violation.impact}): ${violation.help} — ${violation.nodes
            .slice(0, 4)
            .map((node) => node.target.join(' '))
            .join(' | ')}`,
      ),
  ).toEqual([])
})

test('a board card reads the work, and its doors have names', async ({ page }) => {
  await page.goto(HOME)

  const card = page.locator('[data-board-card="b-atlas"]')
  await expect(card.locator('[data-board-reading="b-atlas"]')).toContainText(/\d+ open/)

  await expect(card.getByRole('link', { name: "Open Team Atlas's dashboard" })).toBeVisible()
  await expect(card.getByRole('link', { name: "Open Team Atlas's timeline" })).toBeVisible()
  await expect(card.getByRole('button', { name: 'More for Team Atlas' })).toBeVisible()
})

test('the kebab closes on Escape, and search finds descriptions and clears back to the list', async ({ page }) => {
  await page.goto(HOME)
  const card = page.locator('[data-board-card="b-atlas"]')

  await card.getByRole('button', { name: 'More for Team Atlas' }).click()
  await expect(card.getByText('Duplicate', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(card.getByText('Duplicate', { exact: true })).toHaveCount(0)

  // The description is part of what a board is, so it is part of the search.
  await page.getByLabel('Search boards').fill('delivery bridge')
  await expect(page.locator('[data-board-card="b-delivery"]')).toBeVisible()
  await expect(page.locator('[data-board-card="b-atlas"]')).toHaveCount(0)

  // A dead end has a way back, whether the query or the band filter emptied the list.
  await page.getByLabel('Search boards').fill('nothing matches this')
  await expect(page.locator('[data-clear-search]')).toBeVisible()
  await page.locator('[data-clear-search]').click()
  await expect(page.getByLabel('Search boards')).toHaveValue('')
  await expect(page.locator('[data-board-card="b-atlas"]')).toBeVisible()
})

test('the home tabs answer the arrow keys, and templates can be searched', async ({ page }) => {
  await page.goto(HOME)
  const boardsTab = page.getByRole('tab', { name: /Boards/ })
  const templatesTab = page.getByRole('tab', { name: /Templates/ })

  await boardsTab.focus()
  await page.keyboard.press('ArrowRight')
  await expect(templatesTab).toHaveAttribute('aria-selected', 'true')
  await expect(templatesTab).toBeFocused()

  await page.getByLabel('Search templates').fill('upstream')
  await expect(page.locator('[data-template-card="tpl-upstream-kanban"]')).toBeVisible()
  await expect(page.locator('[data-template-card]')).toHaveCount(1)
  await page.getByLabel('Search templates').fill('')
  expect(await page.locator('[data-template-card]').count()).toBeGreaterThan(1)
})

test('a link names the workspace home tab', async ({ page }) => {
  await page.goto('/app?view=boards&tab=templates')
  const templates = page.getByRole('tab', { name: /Templates/ })
  await expect(templates).toHaveAttribute('aria-selected', 'true')
  await expect(page).toHaveURL(/tab=templates/)

  await page.reload()
  await expect(templates).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: /Boards/ }).click()
  await expect(page.getByRole('tab', { name: /Boards/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page).toHaveURL(/view=boards/)
  await expect(page).not.toHaveURL(/tab=templates/)
})

test('a board with a description offers it on hover', async ({ page }) => {
  await page.goto(HOME)
  const description = page.locator('[data-board-description="b-atlas"]')
  await expect(description).toHaveCount(1)
  await expect(page.getByText("Team Atlas’s own flow", { exact: false })).not.toBeVisible()

  await description.hover()
  await expect(page.getByText("Team Atlas’s own flow", { exact: false })).toBeVisible()
})
