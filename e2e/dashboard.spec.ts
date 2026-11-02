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

test('the attention tiles never leave an empty cell', async ({ page }) => {
  const tiles = page.locator('[data-attention-tile]')
  const boxes = () =>
    tiles.evaluateAll((els) =>
      els.map((el) => {
        const box = el.getBoundingClientRect()
        return { top: Math.round(box.top), width: Math.round(box.width) }
      }),
    )

  // Seven signals on one row where the card can hold seven narrow cells.
  await page.setViewportSize({ width: 1300, height: 900 })
  await page.goto('/app?board=b-atlas&view=dashboard')
  await expect(tiles).toHaveCount(7)
  expect(new Set((await boxes()).map((box) => box.top)).size, 'all seven on one row').toBe(1)

  // A middle width gives four and three, and the odd tile takes the rest of its row rather than
  // leaving the grid's gap ground showing as an empty grey cell.
  await page.setViewportSize({ width: 1000, height: 900 })
  await page.waitForTimeout(200)
  const middle = await boxes()
  expect(new Set(middle.map((box) => box.top)).size, 'four and three').toBe(2)
  expect(middle[6].width, 'the last tile takes the rest of the row').toBeGreaterThan(middle[0].width * 1.8)

  // Narrow, they pair up and the odd tile still fills its row.
  await page.setViewportSize({ width: 700, height: 900 })
  await page.waitForTimeout(200)
  const narrow = await boxes()
  expect(new Set(narrow.map((box) => box.top)).size, 'pairs and a full row').toBe(4)
  expect(narrow[6].width, 'the last tile fills the row').toBeGreaterThan(narrow[0].width * 1.8)
})
