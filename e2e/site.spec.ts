import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

/**
 * The site at the root and the app under `/app` (task 151).
 *
 * What is asserted here is what a *host* does, not what the build contains: `scripts/check-site.mjs`
 * owns the HTML, the heads, the budget and the sitemap. This is the served behaviour — a page a
 * crawler can read with no JavaScript, a legacy link that still lands, an unknown path that answers
 * 404 with a 404, and nothing fetched from another origin.
 */

const SELF_HOSTED = 'http://localhost:4174'

test('the front page is the site, and it is readable with no JavaScript at all', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  try {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('The truth is derived')
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
    await expect(page.getByRole('contentinfo')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open the demo — no account' }).first()).toBeVisible()
    // The picture the page is about, the questions it answers, and the links into the rest of the site.
    await expect(page.locator('main img')).toHaveCount(1)
    await expect(page.getByRole('term')).toHaveCount(5)
    await expect(page.getByRole('link', { name: 'Pricing' }).first()).toBeVisible()
  } finally {
    await context.close()
  }
})

test('a link to the old app lands on the same place under /app, and survives a reload', async ({ page }) => {
  await page.goto('/?board=b-atlas')
  // The home page's one script puts the visitor where the link meant, before anything paints.
  await expect(page).toHaveURL(/\/app\?board=b-atlas$/)
  await expect(page.locator('[data-workflow="cards"]')).toBeVisible()

  await page.reload()
  await expect(page).toHaveURL(/\/app\?board=b-atlas$/)
  await expect(page.locator('[data-workflow="cards"]')).toBeVisible()

  // A link to a *view* lands on that view, and a reload keeps it.
  await page.goto('/?board=b-atlas&view=dashboard')
  await expect(page).toHaveURL(/\/app\?board=b-atlas&view=dashboard$/)
  await page.reload()
  await expect(page).toHaveURL(/\/app\?board=b-atlas&view=dashboard$/)
})

test('the whole query is carried across, before the app normalises it', async ({ page }) => {
  // The shim's job is the *search string*; what the app then keeps of it is the app's own grammar
  // and its own business. So the assertion is the first navigation to `/app`, not the last.
  const visited: string[] = []
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) visited.push(frame.url())
  })

  await page.goto(`/?board=b-atlas&lens=init-signup&q=signup&filters=${encodeURIComponent('[]')}`)
  await expect
    .poll(() => visited.some((url) => url.includes('/app?board=b-atlas&lens=init-signup&q=signup&filters=')))
    .toBe(true)
})

test('an unknown path is the 404 page, with a 404 — on the static host and on the Node entry', async ({ request }) => {
  for (const origin of ['', SELF_HOSTED]) {
    const response = await request.get(`${origin}/this/does/not/exist`)
    expect(response.status(), origin || '/').toBe(404)
    expect(await response.text()).toContain('There is nothing at this address')
  }
})

test('the app is under /app, and answers deep links there', async ({ request }) => {
  for (const origin of ['', SELF_HOSTED]) {
    const page = await request.get(`${origin}/app?board=b-atlas`)
    expect(page.status(), origin || '/').toBe(200)
    expect(await page.text()).toContain('id="root"')
    // A path under it is still the app: the board's places are a query string.
    expect((await request.get(`${origin}/app/some/deep/link`)).status()).toBe(200)
  }
})

test('the terms stand beside the door, and the help page answers', async ({ page, request }) => {
  // The door is on the instance with a server, because an account menu is what a server offers: the
  // static tier has no ways in and so has nothing to stand the terms beside.
  await page.goto(`${SELF_HOSTED}/app`)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()

  const terms = page.getByRole('link', { name: 'terms' })
  await expect(terms).toHaveAttribute('href', '/terms/')
  await expect(page.getByRole('link', { name: 'privacy notice' })).toHaveAttribute('href', '/privacy/')
  // A link that resolves: the page the promise points at is the page that exists.
  expect((await request.get('/terms/')).status()).toBe(200)

  // And the support address is a link that opens, with the promise beside it.
  const help = await request.get('/help/')
  expect(help.status()).toBe(200)
  expect(await help.text()).toContain('mailto:support@flowline.example')
})

test('the changelog is dated, newest first', async ({ request }) => {
  const html = await (await request.get('/changelog/')).text()
  const dates = [...html.matchAll(/<time datetime="(\d{4}-\d{2}-\d{2})">/g)].map((match) => match[1])
  expect(dates.length).toBeGreaterThan(0)
  expect(dates).toEqual([...dates].sort().reverse())
})

test('the home page and the product page have no barrier a machine can find', async ({ page }) => {
  for (const path of ['/', '/product/']) {
    await page.goto(path)
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    const barriers = violations
      .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
      .map((violation) => `${violation.id}: ${violation.help} — ${violation.nodes[0]?.target.join(' ')}`)
    expect(barriers, path).toEqual([])
  }
})

test('the home page holds at 320 pixels wide', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto('/')
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
  // And it is still the page: the heading, the demo action, the questions.
  await expect(page.getByRole('heading', { level: 1 })).toContainText('The truth is derived')
  await expect(page.getByRole('link', { name: 'Open the demo — no account' }).first()).toBeVisible()
})

test('no public page fetches anything from another origin', async ({ page }) => {
  const foreign: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    const local = url.origin === 'http://localhost:4173' || url.origin === 'http://localhost:4174'
    if (!url.pathname.startsWith('/app') && !local) foreign.push(request.url())
  })

  for (const path of ['/', '/pricing/', '/help/', '/self-host/', '/changelog/', '/status/', '/privacy/', '/terms/', '/security/', '/sub-processors/', '/signup/']) {
    await page.goto(path)
    await expect(page.locator('main h1')).toBeVisible()
  }

  expect(foreign).toEqual([])
})
