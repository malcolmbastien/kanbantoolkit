import { expect, test } from '@playwright/test'

test('an In Progress status pill stays on one line', async ({ page }) => {
  await page.goto('/app?board=b-lob&view=dashboard')
  await expect(page.getByRole('columnheader', { name: 'Status' }).first()).toBeVisible()

  const pill = page.locator('td').getByText('In Progress', { exact: true }).first()
  await expect(pill).toBeVisible()
  // The cell is narrow; without nowrap the two words break and the pill grows into a block.
  await expect(pill).toHaveCSS('white-space', 'nowrap')
  const box = await pill.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.height).toBeLessThan(24)
})

test('the attention tiles fill every row, and All issues is the way back', async ({ page }) => {
  const tiles = page.locator('[data-attention-tile]')
  const boxes = () =>
    tiles.evaluateAll((els) =>
      els.map((el) => {
        const box = el.getBoundingClientRect()
        return { top: Math.round(box.top), width: Math.round(box.width) }
      }),
    )

  // Seven signals and the default view: eight on one row where the card can hold eight cells.
  await page.setViewportSize({ width: 1300, height: 900 })
  await page.goto('/app?board=b-atlas&view=dashboard')
  await expect(tiles).toHaveCount(8)
  expect(new Set((await boxes()).map((box) => box.top)).size, 'all eight on one row').toBe(1)

  // A middle width gives two rows of four, and narrow gives four pairs: eight divides evenly, so
  // the grid's gap ground is never left showing as an empty cell.
  await page.setViewportSize({ width: 1000, height: 900 })
  await page.waitForTimeout(200)
  expect(new Set((await boxes()).map((box) => box.top)).size, 'two rows of four').toBe(2)
  await page.setViewportSize({ width: 700, height: 900 })
  await page.waitForTimeout(200)
  const narrow = await boxes()
  expect(new Set(narrow.map((box) => box.top)).size, 'four pairs').toBe(4)
  expect(new Set(narrow.map((box) => box.width)).size, 'every cell is the same width').toBe(1)

  // All issues is the default and the way back from any signal filter.
  const all = page.locator('[data-attention-tile="all"]')
  await expect(all).toHaveAttribute('aria-pressed', 'true')
  await page.locator('[data-attention-tile="blocked"]').click()
  await expect(all).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('[data-attention-summary]')).toContainText('Blocked')
  await all.click()
  await expect(all).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-attention-summary]')).toContainText('need a look')
})

test('Needs attention shows priority, and the urgent work leads', async ({ page }) => {
  await page.goto('/app?board=b-atlas&view=dashboard')
  const attention = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Needs attention' }) })
  await expect(attention.getByRole('columnheader', { name: 'Priority' })).toBeVisible()
  await expect(attention.locator('[data-priority="urgent"]').first()).toContainText('Urgent')

  const rows = attention.locator('tbody tr[data-item-row]')
  await expect(rows.first().locator('[data-priority]')).toHaveAttribute('data-priority', 'urgent')
  // Status is the lowest-level column, not the whole lane path: the dashboard is read away from
  // the board, so its ancestors would be context the reader cannot see.
  const sso = rows.filter({ hasText: 'Add SSO for enterprise tenants' })
  await expect(sso.locator('td').nth(2)).toHaveText('Dev')
  // Not Started work with no owner is not a finding; In Progress work is.
  const notStarted = rows.filter({ hasText: 'Migrate invoice numbering' })
  await expect(notStarted).not.toContainText('Unassigned')
})

test('attention card titles share a left edge under their type', async ({ page }) => {
  await page.goto('/app?board=b-atlas&view=dashboard')
  const attention = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Needs attention' }) })
  const titles = attention.locator('[data-attention-title]')
  await expect(titles.first()).toBeVisible()
  const lefts = await titles.evaluateAll((elements) =>
    elements.map((element) => Math.round(element.getBoundingClientRect().left)),
  )
  expect(new Set(lefts).size, 'every title starts in the same column').toBe(1)
})

test('the initiatives table has a section header of its own', async ({ page }) => {
  await page.goto('/app?board=b-lob&view=dashboard')

  // The page reads as three answers — Time in column, Initiatives, Needs attention — rather than
  // a board header followed by an unexplained table.
  const heading = page.getByRole('heading', { name: 'Initiatives', exact: true })
  await expect(heading).toBeVisible()
  await expect(page.getByText('Rolled up from the work below')).toBeVisible()

  const status = page.getByRole('columnheader', { name: 'Status' }).first()
  const head = (await heading.boundingBox())!
  const column = (await status.boundingBox())!
  expect(column.y, 'the table sits under its header').toBeGreaterThan(head.y)
})

test('the Dates column names the plan and the promise separately', async ({ page }) => {
  await page.goto('/app?board=b-atlas&view=dashboard')

  const row = page.locator('[data-item-row="init-signup-redesign"]')
  const target = row.locator('[data-date="target"]')
  const due = row.locator('[data-date="due"]')

  // The plan reaches December; the promise was November, and that is why the row is late.
  await expect(target).toContainText('Target')
  await expect(target).toContainText('Dec 31, 2026')
  await expect(due).toContainText('Due')
  await expect(due).toContainText('Nov 4, 2026')
  await expect(due).toContainText(/overdue/)

  // Neither line stands in for the other.
  expect(await target.innerText()).not.toContain('Nov 4, 2026')
  expect(await due.innerText()).not.toContain('Dec 31, 2026')
})
