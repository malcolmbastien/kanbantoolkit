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
