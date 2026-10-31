import { expect, test } from '@playwright/test'

test('a programme board marks its linked bands as read-only', async ({ page }) => {
  await page.goto('/app?board=b-delivery')
  await expect(page.getByText('Linked boards', { exact: true })).toBeVisible()

  // The section says it once, and each linked band says it at its own header.
  await expect(page.getByText('read-only', { exact: true })).toBeVisible()
  const bands = page.getByText('Read-only', { exact: true })
  await expect(bands).toHaveCount(2)
  await expect(bands.first()).toHaveAttribute('title', /Read-only here/)

  // The way to change a linked band's work is its own board, named by the action.
  await page.getByRole('button', { name: 'Open board' }).first().click()
  await expect(page.getByRole('button', { name: /^Team / })).toBeVisible()
})
