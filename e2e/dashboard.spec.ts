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
