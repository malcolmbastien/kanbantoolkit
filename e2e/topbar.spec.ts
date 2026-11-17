import { expect, test } from '@playwright/test'
import { openBoard } from './support'

/**
 * The top bar is the one piece of chrome every surface shares, and it holds a lot: the board
 * switcher, six views, making work, search, settings and the account. A narrow window must not
 * make it wrap, because a second line of navigation costs the board its height on every screen.
 */
test('the top bar stays one row as the window narrows', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await openBoard(page)

  const bar = page.locator('[data-top-bar]')
  const nav = page.locator('[data-board-nav]')
  await expect(bar).toBeVisible()
  const singleRow = (await bar.boundingBox())!.height

  // Every breakpoint the bar changes at, plus the widths where it used to wrap.
  for (const width of [1440, 1280, 1024, 900, 768, 640, 520]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect.poll(async () => Math.round((await bar.boundingBox())!.height)).toBe(Math.round(singleRow))
    await expect(nav).toBeVisible()

    // Every control still sits on that one line: the centre of each is the bar's own centre.
    // Tops alone would differ, because the controls are not all the same height.
    const centres = await bar.evaluate((element) => {
      const mid = element.getBoundingClientRect().top + element.getBoundingClientRect().height / 2
      return [...element.children].map((child) => {
        const rect = child.getBoundingClientRect()
        return Math.round(rect.top + rect.height / 2 - mid)
      })
    })
    for (const offset of centres) expect(Math.abs(offset), `the bar wraps at ${width}px`).toBeLessThan(2)

    // And the bar never widens the page: its own navigation scrolls instead.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, `the page scrolls sideways at ${width}px`).toBeLessThanOrEqual(0)
  }
})

/**
 * A breakpoint is a guess about the room a row has. The bar measures the room instead: the same
 * window shows the views by name when the board, the account and the actions leave space for them,
 * and the words come back when a resize frees that space again.
 */
test('the views keep their words while the row has room for them', async ({ page }) => {
  // 1440 leaves well over a hundred pixels of slack: the assertion is about measuring the row,
  // not about a boundary the browser's font metrics can tip either way.
  await page.setViewportSize({ width: 1440, height: 1000 })
  await openBoard(page)

  const bar = page.locator('[data-top-bar]')
  const dashboard = page.getByRole('button', { name: 'Dashboard' })
  await expect.poll(async () => bar.getAttribute('data-bar-words')).toBe('views')
  await expect(dashboard.locator(':scope > span')).toHaveCSS('position', 'static')

  // Narrower than the words need: the icon keeps the place and the name stays in the accessible
  // name — but the *row* decides that, not a fixed width.
  await page.setViewportSize({ width: 900, height: 1000 })
  await expect.poll(async () => bar.getAttribute('data-bar-words')).toBe('none')
  await expect(dashboard.locator(':scope > span')).toHaveCSS('position', 'absolute')
  await expect(dashboard).toHaveAttribute('title', /Dashboard/)

  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect.poll(async () => bar.getAttribute('data-bar-words')).toBe('views')
  await expect(dashboard.locator(':scope > span')).toHaveCSS('position', 'static')
})

/**
 * The workspace home has no board navigation, so nothing pins the actions to the left. They still
 * belong at the right edge, where a person reaches for search and their account.
 */
test('the workspace home keeps its actions at the right edge', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/app')
  await expect(page.getByRole('heading', { name: 'Workspace Home' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Board navigation' })).toHaveCount(0)

  const bar = page.locator('[data-top-bar]')
  const actions = page.locator('[data-bar-actions]')
  const barBox = (await bar.boundingBox())!
  const actionsBox = (await actions.boundingBox())!
  // The header's own px-3 is the gap between the actions and the edge.
  expect(Math.round(barBox.x + barBox.width - (actionsBox.x + actionsBox.width))).toBe(12)
})

/**
 * A control that gives up its word keeps its place and its name. At a tight width the views are
 * icons; the word is still the accessible name and the tooltip still names it, so nothing becomes
 * reachable only by knowing where it is.
 */
test('a narrow bar keeps every view reachable, by name and by click', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 1000 })
  await openBoard(page)

  const dashboard = page.getByRole('button', { name: 'Dashboard' })
  const label = dashboard.locator(':scope > span')
  // Collapsed, not removed: the word is 1px and read out, and the button says what it does.
  await expect(label).toHaveCSS('position', 'absolute')
  expect((await label.boundingBox())!.width).toBeLessThanOrEqual(1)
  await expect(dashboard).toHaveAttribute('title', /Dashboard/)

  // The navigation scrolls rather than wrapping; Playwright scrolls it like a person would.
  await dashboard.click()
  await expect(dashboard).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'Archive' }).click()
  await expect(page.getByRole('button', { name: 'Archive' })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'Board', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Board', exact: true })).toHaveAttribute('aria-pressed', 'true')

  // The actions that left the row for the menu are the same actions, still offered.
  await page.getByRole('button', { name: 'More actions' }).click()
  const more = page.getByRole('menu', { name: 'More actions' })
  await expect(more.getByRole('menuitem', { name: 'Keyboard shortcuts' })).toBeVisible()
  await expect(more.getByRole('menuitem', { name: 'Edit board' })).toBeVisible()
  await more.getByRole('menuitem', { name: 'Board settings' }).click()
  await expect(page.locator('[data-board-settings]')).toBeVisible()
  await page.getByRole('button', { name: 'Close board settings' }).click()

  // The bar is still one row after moving between views.
  const bar = page.locator('[data-top-bar]')
  const centres = await bar.evaluate((element) => {
    const mid = element.getBoundingClientRect().top + element.getBoundingClientRect().height / 2
    return [...element.children].map((child) => {
      const rect = child.getBoundingClientRect()
      return Math.round(rect.top + rect.height / 2 - mid)
    })
  })
  for (const offset of centres) expect(Math.abs(offset)).toBeLessThan(2)
})
