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

test('the attention tiles fit one row, and a narrow card leaves no empty cell', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 })
  await page.goto('/app?board=b-atlas&view=dashboard')

  const tiles = page.locator('[data-attention-tile]')
  await expect(tiles).toHaveCount(5)
  const tops = await tiles.evaluateAll((els) =>
    els.map((el) => Math.round(el.getBoundingClientRect().top)),
  )
  // Where the card can hold five narrow cells, five signals are one row: no 3 + 2 wrap with a
  // grey gap standing where a sixth cell would be.
  expect(new Set(tops).size, 'the five readings sit on one row').toBe(1)

  // Narrower than that they pair up, and the odd fifth takes the whole row rather than leaving
  // the grid's gap ground showing as an empty cell.
  await page.setViewportSize({ width: 700, height: 900 })
  await page.waitForTimeout(200)
  const boxes = await tiles.evaluateAll((els) =>
    els.map((el) => {
      const box = el.getBoundingClientRect()
      return { top: Math.round(box.top), width: Math.round(box.width) }
    }),
  )
  expect(new Set(boxes.map((box) => box.top)).size, 'two pairs and a full row').toBe(3)
  expect(boxes[4].width, 'the last tile fills the row').toBeGreaterThan(boxes[0].width * 1.8)
})
