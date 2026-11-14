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

  const detail = page.getByRole('radiogroup', { name: 'Level of detail' })
  const before = (await toggle.boundingBox())!
  const detailBefore = (await detail.boundingBox())!
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-connection-legend]')).toBeVisible()
  // Turning the lens on must not move the control out from under the pointer, nor the Detail
  // control beside it.
  expect(Math.abs((await toggle.boundingBox())!.x - before.x)).toBeLessThanOrEqual(1)
  expect(Math.abs((await detail.boundingBox())!.x - detailBefore.x)).toBeLessThanOrEqual(1)
  await expect(page.locator('[data-connection-kind="hierarchy"]').first()).toBeVisible()
  await expect(page.locator('[data-connection-kind="dependency"]').first()).toBeVisible()

  // The two kinds are told apart by colour, but share the same circle start and arrow end.
  await expect(page.locator('[data-connection-kind="hierarchy"] path').first()).not.toHaveAttribute('stroke-dasharray', '6 4')
  await expect(page.locator('[data-connection-kind="hierarchy"] path').first()).toHaveAttribute('stroke', '#2563eb')
  await expect(page.locator('[data-connection-kind="hierarchy"] path').first()).toHaveAttribute('marker-end', /connection-arrow/)
  await expect(page.locator('[data-connection-kind="dependency"] path').first()).toHaveAttribute('stroke', '#dc2626')
  await expect(page.locator('[data-connection-kind="dependency"] path').first()).toHaveAttribute('marker-end', /connection-arrow/)
  await expect(page.locator('[data-connection-kind="hierarchy"] [data-connection-start]').first()).toBeVisible()
  await expect(page.locator('[data-connection-kind="dependency"] [data-connection-start]').first()).toBeVisible()

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('[data-connection-link]')).toHaveCount(0)
})

test('two children stacked in one column leave the same point and fan into different curves', async ({ page }) => {
  await openBoard(page)

  // Put two children of Signup redesign in the same cell, which is the layout that used to draw
  // one string over the other: both cards share the parent's centre line.
  const changed = await page.evaluate(() => {
    const key = 'kanbantoolkit-state-v3'
    const raw = localStorage.getItem(key)
    if (!raw) return false
    const parsed = JSON.parse(raw) as {
      state?: { placements?: Array<{ itemId: string; laneId: string }> }
    }
    const placements = parsed.state?.placements
    if (!placements) return false
    const rebuild = placements.find((p) => p.itemId === 'st-signup-rebuild')
    const validation = placements.find((p) => p.itemId === 'st-signup-validation')
    if (!rebuild || !validation) return false
    validation.laneId = rebuild.laneId
    localStorage.setItem(key, JSON.stringify(parsed))
    return true
  })
  expect(changed).toBe(true)

  await page.reload()
  await page.getByRole('button', { name: 'Connections', exact: true }).click()

  const path = (id: string) => page.locator(`[data-connection-link="${id}"] path`)
  const rebuild = (await path('e-13').getAttribute('d'))!
  const validation = (await path('e-14').getAttribute('d'))!

  // One cubic each — no side gutter, no elbow.
  expect(rebuild).not.toContain(' L ')
  expect(validation).not.toContain(' L ')
  expect(rebuild).not.toBe(validation)

  const geometry = await page.evaluate(() => {
    const content = document.querySelector('[data-board-scroll] > div')!.getBoundingClientRect()
    const box = (id: string) => {
      const r = document.querySelector(`[data-card-id="${id}"]`)!.getBoundingClientRect()
      return { left: r.left - content.left, top: r.top - content.top, width: r.width, height: r.height }
    }
    return {
      parent: box('init-signup-redesign'),
      rebuild: box('st-signup-rebuild'),
      validation: box('st-signup-validation'),
    }
  })

  // Both leave the parent at its bottom-left, a little inside the card.
  const start = (d: string) => d.split(' ').slice(1, 3).map(Number)
  const [rebuildX, rebuildY] = start(rebuild)
  const [validationX, validationY] = start(validation)
  const startInset = Math.min(12, geometry.parent.width / 3, geometry.parent.height / 3)
  expect(rebuildX).toBeCloseTo(geometry.parent.left + startInset, 1)
  expect(rebuildY).toBeCloseTo(geometry.parent.top + geometry.parent.height - startInset, 1)
  expect(validationX).toBeCloseTo(rebuildX, 1)
  expect(validationY).toBeCloseTo(rebuildY, 1)

  // Each lands on its own child's top edge, overlapping it slightly.
  const end = (d: string) => d.split(' ').slice(-2).map(Number)
  const [rebuildEndX, rebuildEndY] = end(rebuild)
  const [validationEndX, validationEndY] = end(validation)
  const endInset = Math.min(4, geometry.rebuild.width / 4, geometry.rebuild.height / 4)
  expect(rebuildEndY).toBeCloseTo(geometry.rebuild.top + endInset, 1)
  expect(validationEndY).toBeCloseTo(geometry.validation.top + endInset, 1)
  expect(rebuildEndX).toBeGreaterThanOrEqual(geometry.rebuild.left)
  expect(rebuildEndX).toBeLessThanOrEqual(geometry.rebuild.left + geometry.rebuild.width)
  expect(validationEndX).toBeGreaterThanOrEqual(geometry.validation.left)
  expect(validationEndX).toBeLessThanOrEqual(geometry.validation.left + geometry.validation.width)
})

test('dependency strings leave the waiting card and fan out without overlapping', async ({ page }) => {
  await onNova(page)

  // Give one card a second blocker, so two strings leave the same waiting item and have to
  // separate immediately rather than sharing a path.
  const changed = await page.evaluate(() => {
    const key = 'kanbantoolkit-state-v3'
    const raw = localStorage.getItem(key)
    if (!raw) return false
    const parsed = JSON.parse(raw) as {
      state?: { links?: Array<{ id: string; from: string; to: string }> }
    }
    const links = parsed.state?.links
    if (!links) return false
    links.push({ id: 'lnk-dependency-check', from: 'st-audit-backfill', to: 'st-cost-attribution' })
    localStorage.setItem(key, JSON.stringify(parsed))
    return true
  })
  expect(changed).toBe(true)

  await page.reload()
  await page.getByRole('button', { name: 'Connections', exact: true }).click()

  const path = (id: string) => page.locator(`[data-connection-link="${id}"] path`)
  const first = (await path('lnk-2').getAttribute('d'))!
  const second = (await path('lnk-dependency-check').getAttribute('d'))!

  // Both leave the waiting card from the same point, a little inside its bottom-left corner.
  const start = (d: string) => d.split(' ').slice(1, 3).map(Number)
  const [firstX, firstY] = start(first)
  const [secondX, secondY] = start(second)
  expect(secondX).toBeCloseTo(firstX, 1)
  expect(secondY).toBeCloseTo(firstY, 1)

  const source = await page.evaluate(() => {
    const content = document.querySelector('[data-board-scroll] > div')!.getBoundingClientRect()
    const card = document.querySelector('[data-card-id="st-cost-attribution"]')!.getBoundingClientRect()
    return {
      x: card.left - content.left,
      bottom: card.bottom - content.top,
      width: card.width,
      height: card.height,
    }
  })
  const inset = Math.min(12, source.width / 3, source.height / 3)
  expect(firstX).toBeCloseTo(source.x + inset, 1)
  expect(firstY).toBeCloseTo(source.bottom - inset, 1)
  await expect(page.locator('[data-connection-link="lnk-2"] [data-connection-start]')).toHaveCount(1)

  // The fan-out is what keeps them from being one string.
  expect(first).not.toBe(second)
})

test('the drawer narrows connections to the open item, and closing it clears the reading', async ({ page }) => {
  await onNova(page)
  await page.locator('[data-card-id="st-cost-attribution"]').click()
  const panel = page.locator('[data-item-panel]')
  await expect(panel).toBeVisible()

  const toggle = panel.getByRole('button', { name: 'Connections', exact: true })
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')

  // Every string left is one that touches the open card: its parent, its blocker, or itself.
  const links = page.locator('[data-connection-link]')
  await expect(links.first()).toBeVisible()
  const ends = await links.evaluateAll((elements) =>
    elements.map((el) => [el.getAttribute('data-connection-from'), el.getAttribute('data-connection-to')]),
  )
  expect(ends.length).toBeGreaterThan(0)
  for (const [from, to] of ends) {
    expect(from === 'st-cost-attribution' || to === 'st-cost-attribution').toBe(true)
  }

  // Closing the drawer ends the item reading; the board lens itself was never turned on.
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(page.locator('[data-connections-toggle]')).toHaveAttribute('aria-pressed', 'false')
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
