import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

/**
 * An automated accessibility check over the views a person actually arrives at.
 *
 * It proves the borrowable part — names on controls, contrast, valid roles, one landmark per
 * thing — and it cannot prove the part that matters most (whether the app is usable). Those are
 * the keyboard and focus tests beside this file. What this adds is a floor in CI: a dialog with no
 * name, a control with no label, a heading order broken by a new panel, fails the build rather
 * than a person's screen reader.
 */

const SELF_HOSTED = 'http://localhost:4174'

/** The two impacts that are a barrier rather than a polish note. */
async function barriers(page: Page, { nestedInteractive = false } = {}) {
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
  if (nestedInteractive) {
    /**
     * The lane tree: a `treeitem` is an interactive role, and a lane's item contains the cards,
     * their menus and their buttons — which this rule reads as an interactive element inside one.
     * The alternative is to abandon the tree and leave the nesting unsaid, which is worse for the
     * person the role exists for, so the exception is made here, by name, on the board only. The
     * lane's own label carries its full path ("Backlog / Dev — 2 cards"), so the structure is
     * still said in words.
     */
    builder.disableRules(['nested-interactive'])
  }
  const { violations } = await builder.analyze()
  return violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help} — ${violation.nodes
          .slice(0, 4)
          .map((node) => node.target.join(' '))
          .join(' | ')}`,
    )
}

test('the board has no barrier a machine can find', async ({ page }) => {
  await page.goto('/app?board=b-atlas')
  await expect(page.locator('[data-workflow="cards"]')).toBeVisible()
  await expect(page.getByRole('tree', { name: /lanes/ })).toBeVisible()
  expect(await barriers(page, { nestedInteractive: true })).toEqual([])
})

test('a card open in its panel has none either', async ({ page }) => {
  await page.goto('/app?board=b-atlas')
  await page.locator('[data-workflow="cards"] [data-card-id]').first().click()
  await expect(page.getByLabel('Title')).toBeVisible()
  expect(await barriers(page, { nestedInteractive: true })).toEqual([])
})

test('the admin screen, signed in, has none', async ({ page }) => {
  await page.goto(`${SELF_HOSTED}/app`)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByPlaceholder('you@example.com').fill('maya.blake@example.com')
  await page.getByRole('button', { name: 'Sign in as this address' }).click()
  await expect(page.getByRole('button', { name: /Maya Blake/ })).toBeVisible()

  await page.goto(`${SELF_HOSTED}/app?view=boards`)
  await page.getByRole('button', { name: /^Admin/ }).click()
  await expect(page.getByRole('heading', { name: 'People' })).toBeVisible()
  expect(await barriers(page)).toEqual([])
})

test('motion stops when the system asks it to', async ({ page }) => {
  /** The longest transition running anywhere in the app, in milliseconds. */
  const longest = () =>
    page.evaluate(() =>
      Math.max(
        0,
        ...[...document.querySelectorAll('*')].flatMap((element) =>
          getComputedStyle(element)
            .transitionDuration.split(',')
            .map((part) => parseFloat(part) * (part.trim().endsWith('ms') ? 1 : 1000)),
        ),
      ),
    )

  await page.goto('/app?board=b-atlas')
  await expect(page.locator('[data-workflow="cards"]')).toBeVisible()
  // The app animates: hovering a control moves it. If it did not, the check below would pass
  // without proving anything.
  expect(await longest()).toBeGreaterThan(10)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  // The stylesheet takes effect immediately, without a reload.
  expect(await longest()).toBeLessThan(5)
})
