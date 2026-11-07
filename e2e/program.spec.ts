import { expect, test } from '@playwright/test'

test('a programme board marks its linked bands as read-only', async ({ page }) => {
  await page.goto('/app?board=b-delivery')
  await expect(page.getByText('Linked boards', { exact: true })).toBeVisible()

  // The section says it once, and each linked band says it at its own header.
  await expect(page.getByText('read-only', { exact: true })).toBeVisible()
  const bands = page.getByText('Read-only', { exact: true })
  await expect(bands).toHaveCount(2)
  await expect(bands.first()).toHaveAttribute('title', /Read-only: this band is read from/)

  // The way to change a linked band's work is its own board, named by the action.
  await page.getByRole('button', { name: 'Open board' }).first().click()
  await expect(page.getByRole('button', { name: /^Team / })).toBeVisible()
})

test('a linked band keeps the initiative kind banner', async ({ page }) => {
  await page.goto('/app?board=b-lob')
  await expect(page.getByText('Linked boards', { exact: true })).toBeVisible()

  // Growth value stream is read-only here, but its initiatives keep the kinds its own board gave
  // them: the band is that board's flow, not a copy of it.
  const band = page.locator('[data-linked-board="b-portfolio"]')
  await expect(band.getByLabel('Kind: Workstream').first()).toBeVisible()
})

test('a programme board links a board from the foot of the board, in edit mode', async ({ page }) => {
  await page.goto('/app?board=b-delivery')

  // Reading a programme is not the place to change what it aggregates. The link is a design
  // action, so it is offered with the others, at the foot of the board.
  await expect(page.getByRole('button', { name: 'Link a board' })).toHaveCount(0)
  await expect(page.getByTitle('Unlink this board')).toHaveCount(0)
  await page.getByRole('button', { name: 'Edit board' }).click()
  const trigger = page.getByRole('button', { name: 'Link a board' })
  await expect(trigger).toBeVisible()
  // Unlinking is the other half of the design, so it appears with it — one per linked band.
  await expect(page.getByTitle('Unlink this board')).toHaveCount(2)
  await trigger.click()

  const dialog = page.locator('[data-link-board-dialog]')
  await expect(dialog).toBeVisible()

  // The menu names the board and its type, with the badge that carries the type's colour and icon.
  const row = dialog.locator('[data-link-board="b-lob"]')
  await expect(row).toContainText('Digital line of business')
  const badge = row.getByTitle('Board type: Program')
  await expect(badge).toBeVisible()
  await expect(badge.locator('svg')).toHaveCount(1)

  await row.click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText('Digital line of business', { exact: true })).toBeVisible()
})
