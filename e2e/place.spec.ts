import { expect, test } from '@playwright/test'
import { cardsIn, openBoard } from './support'

/** The place a tab is: what the title says, and what a crawler reads without running the app. */
test('the title follows the place, and going back returns it', async ({ page }) => {
  await openBoard(page)
  // `page.title()` rather than `toHaveTitle`: the latter reads the navigation entry's title, which
  // an app that names itself with `document.title` leaves empty.
  await expect.poll(() => page.title()).toBe('Team Atlas · Flowline')

  // A journey is a step in history — a view — so back returns to the board.
  await page.getByRole('button', { name: 'Dashboard' }).click()
  await expect.poll(() => page.title()).toBe('Dashboard · Team Atlas · Flowline')

  await page.goBack()
  await expect.poll(() => page.title()).toBe('Team Atlas · Flowline')
})

test('an open card is the title, and closing it returns the board’s', async ({ page }) => {
  await openBoard(page)
  const [id] = await cardsIn(page, 'Backlog')
  await page.locator(`[data-card-id="${id}"]`).click()

  const cardTitle = await page.getByLabel('Title').inputValue()
  await expect.poll(() => page.title()).toBe(`${cardTitle} · Team Atlas · Flowline`)

  // An open card is a place, not a step: closing it is how the board comes back.
  await page.keyboard.press('Escape')
  await expect.poll(() => page.title()).toBe('Team Atlas · Flowline')
})

test('a crawler that runs no JavaScript still reads a useful page, and nothing of the workspace', async ({ request }) => {
  // The front page is the *site* (task 151): the app is under `/app`, and this is what a stranger —
  // or a crawler — is handed. The app's own document is at `/app`, and answers the same way.
  const response = await request.get('/')
  const html = await response.text()

  expect(html).toContain('<title>Flowline')
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
  // The board is the app's own path: a file or two, not one per screen.
  expect(atBoard.size).toBeLessThan(4)

  await page.getByRole('button', { name: 'Dashboard' }).click()
  await expect.poll(() => scripts.filter((url) => !atBoard.has(url)).length).toBeGreaterThan(0)
})
