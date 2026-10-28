import { expect, test } from '@playwright/test'
import { cardsIn, openBoard } from './support'

/** The place a tab is: what the title says, and what a crawler reads without running the app. */
test('the title follows the place, and going back returns it', async ({ page }) => {
  await openBoard(page)
  // `page.title()` rather than `toHaveTitle`: the latter reads the navigation entry's title, which
  // an app that names itself with `document.title` leaves empty.
  await expect.poll(() => page.title()).toBe('Team Atlas · Kanban Toolkit')

  // A journey is a step in history — a view — so back returns to the board. The board leads the
  // name and the view follows it, because the board is the page and the view is a surface of it.
  await page.getByRole('button', { name: 'Dashboard' }).click()
  await expect.poll(() => page.title()).toBe('Team Atlas · Dashboard · Kanban Toolkit')

  await page.goBack()
  await expect.poll(() => page.title()).toBe('Team Atlas · Kanban Toolkit')
})

test('opening a card does not rename the page, and closing it leaves the board’s', async ({ page }) => {
  await openBoard(page)
  const [id] = await cardsIn(page, 'Backlog')
  await page.locator(`[data-card-id="${id}"]`).click()

  // The open card is deliberately not part of the name (see `src/lib/title.ts`): a tab that
  // changes every time a drawer opens makes the board harder to find, not easier.
  await expect(page.getByLabel('Title')).toBeVisible()
  await expect.poll(() => page.title()).toBe('Team Atlas · Kanban Toolkit')

  // Closing it returns the board — which, on this page, is where it already was.
  await page.keyboard.press('Escape')
  await expect.poll(() => page.title()).toBe('Team Atlas · Kanban Toolkit')
})

test('a crawler that runs no JavaScript still reads a useful page, and nothing of the workspace', async ({ request }) => {
  // The front page is the *site* (task 151): the app is under `/app`, and this is what a stranger —
  // or a crawler — is handed. The app's own document is at `/app`, and answers the same way.
  const response = await request.get('/')
  const html = await response.text()

  expect(html).toContain('<title>Kanban Toolkit')
  expect(html).toMatch(/property="og:title"/)
  expect(html).toMatch(/property="og:description"/)
  expect(html).toMatch(/name="twitter:card"/)
  expect(html).toMatch(/name="theme-color"/)
  // Boards and cards live in the browser, so a preview cannot name one — and must not try.
  expect(html).not.toContain('Team Atlas')
})

test('a screen is downloaded when it is first opened, not before', async ({ page }) => {
  const scripts: string[] = []
  page.on('response', (response) => {
    if (response.url().includes('/assets/') && response.url().endsWith('.js')) scripts.push(response.url())
  })

  await openBoard(page)
  const atBoard = new Set(scripts)
  // The board is the app's own path: the entry, its runtime, a shared module chunk and the command
  // palette — not one file per screen. What matters is which *screens* are absent, so the count is a
  // sanity bound and the list below is the promise.
  expect(atBoard.size).toBeLessThan(6)
  for (const screen of ['ItemPanel', 'AdminView', 'TimelineView', 'ManagementDashboard', 'MetricsView', 'ObjectivesView', 'MyWorkView', 'ArchiveView', 'BoardSettings', 'SignInPanel']) {
    expect([...atBoard].some((url) => url.includes(`/${screen}-`)), screen).toBe(false)
  }

  await page.getByRole('button', { name: 'Dashboard' }).click()
  await expect.poll(() => scripts.filter((url) => !atBoard.has(url)).length).toBeGreaterThan(0)
})
