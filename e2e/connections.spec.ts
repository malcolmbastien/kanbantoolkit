import { expect, test } from '@playwright/test'
import { dropAtEnd, openBoard } from './support'

/**
 * The Connections lens: every hierarchy and dependency edge on the board, drawn as red strings.
 *
 * The demo's second team board has both kinds with both ends on the board: initiatives decompose
 * into its cards, and two of its cards depend on other cards in the same flow. The first board's
 * dependencies cross its edge, which is the boundary workflow's reading, not this one.
 */

const NOVA = '/app?board=b-nova'

async function onNova(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(NOVA)
  await expect(page.locator('[data-workflow="cards"] [data-card-id]').first()).toBeVisible()
}

test('the lens is off at rest, and the button draws and clears every edge', async ({ page }) => {
  await onNova(page)
  const toggle = page.getByRole('button', { name: 'Connections', exact: true })
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('[data-connection-link]')).toHaveCount(0)

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-connection-legend]')).toBeVisible()
  await expect(page.locator('[data-connection-kind="hierarchy"]').first()).toBeVisible()
  await expect(page.locator('[data-connection-kind="dependency"]').first()).toBeVisible()

  // The two kinds are not one red knot: hierarchy is dashed, dependency solid with an arrow.
  await expect(page.locator('[data-connection-kind="hierarchy"] path').first()).toHaveAttribute('stroke-dasharray', '6 4')
  await expect(page.locator('[data-connection-kind="dependency"] path').first()).toHaveAttribute('marker-end', /connection-arrow/)

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('[data-connection-link]')).toHaveCount(0)
})

test('the boundary band is part of the same graph', async ({ page }) => {
  await openBoard(page)
  await page.getByRole('button', { name: 'Connections', exact: true }).click()

  // Atlas waits on Team Nova's identity platform; its boundary card is rendered in the bottom
  // band, so the connection reaches down to it just as it reaches across the cards.
  const boundary = page.locator('[data-connection-link="boundary:init-identity:st-enterprise-sso"]')
  await expect(boundary).toHaveCount(1)
  await expect(boundary).toHaveAttribute('data-connection-kind', 'dependency')
  await expect(boundary.locator('path')).toHaveAttribute('marker-end', /connection-arrow/)
})

test('the choice belongs to this browser and this board', async ({ page }) => {
  await onNova(page)
  await page.getByRole('button', { name: 'Connections', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Connections', exact: true })).toHaveAttribute('aria-pressed', 'true')

  await page.reload()
  await expect(page.locator('[data-workflow="cards"] [data-card-id]').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Connections', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-connection-link]').first()).toBeVisible()

  // Atlas has its own choice; opening it does not inherit Nova's.
  await openBoard(page)
  await expect(page.getByRole('button', { name: 'Connections', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('[data-connection-link]')).toHaveCount(0)
})

test('a move redraws the string, and folding a flow takes its strings away', async ({ page }) => {
  await onNova(page)
  await page.getByRole('button', { name: 'Connections', exact: true }).click()

  const dependency = page.locator('[data-connection-link="lnk-2"] path')
  const before = await dependency.getAttribute('d')
  // The blocker is in the visible part of the flow; moving it changes the end this string reaches.
  const blocker = page.locator('[data-card-id="st-lakehouse-ingest"]')
  await blocker.scrollIntoViewIfNeeded()
  await dropAtEnd(page, 'st-lakehouse-ingest', 'Done')
  await expect(dependency).not.toHaveAttribute('d', before!)

  // The cards flow folded: its cards have no elements, so no string can end at one.
  await page.getByRole('button', { name: 'Collapse Cards' }).click()
  await expect(page.locator('[data-connection-link]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Expand Cards' }).click()
  await expect(page.locator('[data-connection-link]').first()).toBeVisible()

  // The lens also reads the compact drawing.
  await page.getByRole('radio', { name: 'Mini' }).click()
  await expect(page.locator('[data-card-detail="mini"]').first()).toBeVisible()
  await expect(page.locator('[data-connection-link]').first()).toBeVisible()
})

test('the 1,000-card board stays usable with the lens on', async ({ page }) => {
  await page.goto('/app?board=stress-board&stress=1000')
  await expect(page.locator('[data-workflow="cards"]').first()).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Connections', exact: true }).click()
  await expect(page.locator('[data-connection-link]').first()).toBeVisible({ timeout: 20_000 })
  expect(await page.locator('[data-connection-link]').count()).toBeGreaterThan(10)
})
