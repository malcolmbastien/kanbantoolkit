import { expect, test } from '@playwright/test'
import { cardsIn, openBoard } from './support'

/**
 * Who made a change. The identity is what the My work view's picker sets, so this drives the real
 * control rather than writing storage — the point is that the app knows whose change it is.
 */
test('a change made while signed in names its author in the Activity', async ({ page }) => {
  await openBoard(page)

  await page.goto('/app?view=mywork')
  await expect(page.getByLabel('Whose work to show')).toBeVisible()
  await page.getByLabel('Whose work to show').selectOption({ label: 'Maya Blake' })
  await page.getByRole('button', { name: 'Close My work' }).click()

  const [id] = await cardsIn(page, 'Backlog')
  await page.locator(`[data-card-id="${id}"]`).click()
  await page.getByLabel('Title').fill('Edited by someone')
  await page.getByRole('button', { name: 'Activity' }).click()

  // The newest entry names who did it, beside when.
  const newest = page.locator('[data-item-panel]').getByText(/edited/i).first()
  await expect(newest).toBeVisible()
  await expect(page.locator('[data-item-panel]').getByText('Maya Blake')).toBeVisible()
})
