import { expect, test, type Page } from '@playwright/test'
import { cardsIn, dropAtEnd, lane, openBoard } from './support'

/**
 * The board's level-of-detail dial.
 *
 * Full is the card the app has always drawn. Summary keeps the key facts and a single blocked or
 * warning badge, and Mini is a colour tile per item. What the levels must not change is the work
 * itself — the same cards, the same count, the same click, drag and design mode — so each test
 * checks the board's behaviour as well as the drawing.
 */

const ATLAS = '/app?board=b-atlas'
const NOVA = '/app?board=b-nova'

async function choose(page: Page, level: 'Mini' | 'Summary' | 'Full'): Promise<void> {
  await page.getByRole('radio', { name: level }).click()
  await expect(page.getByRole('radio', { name: level })).toHaveAttribute('aria-checked', 'true')
}

test('Summary keeps the title, type, due date and people, and drops the extras', async ({ page }) => {
  await openBoard(page)
  await expect(page.getByRole('radio', { name: 'Full' })).toHaveAttribute('aria-checked', 'true')

  const backlog = await cardsIn(page, 'Backlog')
  const rebuilt = page.locator('[data-card-id="st-signup-rebuild"]')
  await expect(rebuilt).toHaveAttribute('data-card-detail', 'full')
  await expect(rebuilt).toContainText('2/4')
  await expect(rebuilt.locator('[aria-label^="Priority"]')).toBeVisible()

  await choose(page, 'Summary')
  await expect(page.getByRole('button', { name: 'Add card to Backlog' }).first()).toBeVisible()
  await expect(rebuilt).toHaveAttribute('data-card-detail', 'summary')
  await expect(rebuilt).toContainText('Rebuild the signup form')
  await expect(rebuilt).toContainText('User Story')
  await expect(rebuilt.locator('[title="Maya Blake"]')).toBeVisible()
  // The extras are gone: no checklist, no priority, no tags.
  await expect(rebuilt).not.toContainText('2/4')
  await expect(rebuilt.locator('[aria-label^="Priority"]')).toHaveCount(0)
  await expect(page.locator('[data-card-id="st-enterprise-sso"]')).not.toContainText('customer-facing')

  // A due date and an assignee are still the card's own, and the date sits at the foot left, where
  // the Full card puts it, rather than in the type row.
  const due = page.locator('[data-card-id="st-usage-billing"]')
  const cardBox = (await due.boundingBox())!
  const dueBox = (await due.locator('[data-due]').boundingBox())!
  await expect(due.locator('[data-due]')).toBeVisible()
  expect(dueBox.y).toBeGreaterThan(cardBox.y + cardBox.height / 2)
  expect(dueBox.x - cardBox.x).toBeLessThan(24)
  await expect(due.locator('[title="Diego Santos"]')).toBeVisible()

  // One badge, not a row: the most urgent finding, red for a risk and amber for a warning.
  const blocked = page.locator('[data-card-id="st-enterprise-sso"]')
  await expect(blocked.locator('[data-card-warning]')).toHaveCount(1)
  await expect(blocked.locator('[data-card-warning]')).toHaveAttribute('data-card-warning', 'risk')
  await expect(blocked.locator('[data-card-warning]')).toHaveText('Blocked')

  // A card with several warnings of both tones still wears one badge: the risk outranks the rest.
  const billing = page.locator('[data-card-id="init-billing"]')
  await expect(billing.locator('[data-card-warning]')).toHaveCount(1)
  await expect(billing.locator('[data-card-warning]')).toHaveAttribute('data-card-warning', 'risk')

  // One warning wears its own words; several become a count, so the badge stays a badge.
  const trial = page.locator('[data-card-id="init-trial"]')
  await expect(trial.locator('[data-card-warning]')).toHaveCount(1)
  await expect(trial.locator('[data-card-warning]')).toHaveAttribute('data-card-warning', 'watch')
  await expect(trial.locator('[data-card-warning]')).toHaveText('2 warnings')

  await expect(rebuilt.locator('[data-card-warning]')).toHaveCount(1)
  await expect(rebuilt.locator('[data-card-warning]')).toHaveAttribute('data-card-warning', 'watch')
  await expect(rebuilt.locator('[data-card-warning]')).not.toContainText('warnings')

  // The same cards are there: a level changes the drawing, not the work.
  expect(await cardsIn(page, 'Backlog')).toEqual(backlog)
})

test('Mini is a colour tile per item, with blocked and warning markers and an accessible name', async ({ page }) => {
  await openBoard(page)
  const backlog = await cardsIn(page, 'Backlog')
  await choose(page, 'Mini')

  const story = page.locator('[data-card-id="st-usage-billing"]')
  const spike = page.locator('[data-card-id="st-pricing-experiment"]')
  await expect(story).toHaveAttribute('data-card-detail', 'mini')
  await expect(story).toHaveAttribute('aria-label', /Add usage-based billing events/)
  // Mini is for scanning: the add-card offer goes with the detail.
  await expect(page.getByRole('button', { name: 'Add card to Backlog' })).toHaveCount(0)
  // The type is the colour: two types do not wear the same tile.
  expect(await story.getAttribute('style')).not.toBe(await spike.getAttribute('style'))

  // Blocked and warning are two channels, not only the type colour.
  await expect(page.locator('[data-card-id="st-enterprise-sso"] [data-card-marker="blocked"]')).toBeVisible()
  await expect(page.locator('[data-card-id="st-signup-validation"] [data-card-marker="warning"]')).toBeVisible()
  await expect(page.locator('[data-card-id="st-enterprise-sso"]')).toHaveAttribute('data-card-blocked', '')
  await expect(page.locator('[data-card-id="st-signup-validation"]')).toHaveAttribute('data-card-warning', '')

  // The same set of cards, in the same order, only smaller.
  expect(await cardsIn(page, 'Backlog')).toEqual(backlog)

  // A tile is still the way into the card.
  await story.click()
  await expect(page.locator('[data-item-panel]')).toHaveAttribute(
    'aria-label',
    'Card details: Add usage-based billing events',
  )
})

test('a Mini tile explains itself on hover, including why it is marked', async ({ page }) => {
  await openBoard(page)
  await choose(page, 'Mini')

  const hover = page.locator('[data-mini-hover-card]')
  await expect(hover).toHaveCount(0)

  // The blocked card: the red marker's reason, the title, the type, the parent and the person.
  const blocked = page.locator('[data-card-id="st-enterprise-sso"]')
  await blocked.hover()
  await expect(hover).toBeVisible()
  await expect(hover).toContainText('Add SSO for enterprise tenants')
  await expect(hover).toContainText('User Story')
  await expect(hover).toContainText('Rolls up to Enterprise SSO')
  await expect(hover).toContainText('Jonah Tran')
  await expect(hover.locator('[data-mini-hover-reason="risk"]')).toContainText('Blocked')
  await expect(hover).toContainText('Waiting on the identity contract')

  // The layer is a reading, not a control: it takes no pointer and adds no second accessible name.
  await expect(hover).toHaveAttribute('aria-hidden', 'true')
  await expect(hover).toHaveCSS('pointer-events', 'none')

  // A warning tile says *why* the amber marker is there, in the same place.
  const warned = page.locator('[data-card-id="st-signup-validation"]')
  await warned.hover()
  await expect(hover).toBeVisible()
  await expect(hover).toContainText('Signup validation on retry')
  await expect(hover).toContainText('Maya Blake')
  await expect(hover.locator('[data-mini-hover-reason="watch"]').first()).toBeVisible()

  // Leaving closes it, and focus is the keyboard's route to the same reading.
  await page.mouse.move(2, 2)
  await expect(hover).toHaveCount(0)
  await warned.focus()
  await expect(hover).toBeVisible()
  await warned.blur()
  await expect(hover).toHaveCount(0)
})

test('an initiative is a Mini tile too, and still opens its card', async ({ page }) => {
  await openBoard(page)
  await choose(page, 'Mini')

  const initiative = page.locator('[data-card-id="init-signup-redesign"]')
  await expect(initiative).toHaveAttribute('data-card-detail', 'mini')
  await expect(initiative).toHaveAttribute('data-card-initiative', '')
  await initiative.click()
  await expect(page.locator('[data-item-panel]')).toHaveAttribute('aria-label', 'Card details: Signup redesign')
})

test('boundary cards follow the board detail level too', async ({ page }) => {
  await openBoard(page)
  const identity = page.locator('[data-boundary-card="init-identity"]')
  await expect(identity).toHaveAttribute('data-boundary-detail', 'full')

  await choose(page, 'Summary')
  await expect(identity).toHaveAttribute('data-boundary-detail', 'summary')
  await expect(identity).toContainText('Identity platform')
  await expect(identity).toContainText('Open · live blockage')
  await expect(identity).toContainText('Waited on by 1 card')

  await choose(page, 'Mini')
  await expect(identity).toHaveAttribute('data-boundary-detail', 'mini')
  await expect(identity).toHaveAttribute('aria-label', /Identity platform/)
  await identity.click()
  await expect(identity).toHaveAttribute('aria-pressed', 'true')
})

test('a boundary Mini tile explains the external work it stands for', async ({ page }) => {
  await openBoard(page)
  await choose(page, 'Mini')

  const tile = page.locator('[data-boundary-card="init-identity"]')
  await tile.scrollIntoViewIfNeeded()
  await tile.hover()

  const hover = page.locator('[data-mini-hover-card]')
  await expect(hover).toBeVisible()
  await expect(hover).toContainText('Identity platform')
  await expect(hover).toContainText('Initiative')
  await expect(hover).toContainText('Open · live blockage')
  await expect(hover).toContainText('On Team Nova')
  await expect(hover).toContainText('Waited on by 1 card')
  await expect(hover.locator('[data-mini-hover-reason="risk"]')).toContainText('live blockage')

  // Selecting the tile still works, and closes the reading layer rather than leaving it over the
  // cards it highlights.
  await tile.click()
  await expect(tile).toHaveAttribute('aria-pressed', 'true')
  await expect(hover).toHaveCount(0)
})

test('a Mini tile is still dragged between cells', async ({ page }) => {
  await openBoard(page)
  await choose(page, 'Mini')

  // The spike sits in Backlog; the card is a tile, and a drop into Done is a move.
  await dropAtEnd(page, 'st-pricing-experiment', 'Done')
  await expect(lane(page, 'Done').locator('[data-card-id="st-pricing-experiment"]')).toBeVisible()
})

test('the level is remembered per board, across a reload', async ({ page }) => {
  await openBoard(page)
  await choose(page, 'Summary')

  await page.goto(NOVA)
  await expect(page.locator('[data-workflow="cards"] [data-card-id]').first()).toBeVisible()
  await choose(page, 'Mini')

  // Atlas is still Summary; Nova is still Mini: the choice belongs to a board, not to the browser
  // as a single setting.
  await page.goto(ATLAS)
  await expect(page.locator('[data-workflow="cards"] [data-card-id]').first()).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Summary' })).toHaveAttribute('aria-checked', 'true')
  await page.reload()
  await expect(page.getByRole('radio', { name: 'Summary' })).toHaveAttribute('aria-checked', 'true')

  await page.goto(NOVA)
  await expect(page.locator('[data-workflow="cards"] [data-card-id]').first()).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Mini' })).toHaveAttribute('aria-checked', 'true')
})

test('design mode draws Full and disables the dial, then returns to the choice', async ({ page }) => {
  await openBoard(page)
  await choose(page, 'Summary')

  await page.getByRole('button', { name: 'Edit board', exact: true }).click()
  await expect(page.getByRole('radio', { name: 'Full' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('radio', { name: 'Summary' })).toBeDisabled()
  await expect(page.locator('[data-card-id="st-signup-rebuild"]')).toHaveAttribute('data-card-detail', 'full')

  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('radio', { name: 'Summary' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('[data-card-id="st-signup-rebuild"]')).toHaveAttribute('data-card-detail', 'summary')
})

test('the 1,000-card load test stays usable at Mini', async ({ page }) => {
  await page.goto('/app?board=stress-board&stress=1000')
  await expect(page.locator('[data-workflow="cards"]').first()).toBeVisible({ timeout: 20_000 })
  await page.getByRole('radio', { name: 'Mini' }).click()
  await expect(page.locator('[data-card-detail="mini"]').first()).toBeVisible({ timeout: 20_000 })
  // The board hides filed-away work, so not every generated card is drawn; the load test is
  // still hundreds of tiles, all at once and with no windowing.
  expect(await page.locator('[data-card-detail="mini"]:not([data-card-initiative])').count()).toBeGreaterThan(800)
})
