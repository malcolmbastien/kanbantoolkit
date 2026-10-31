import { expect, test, type Page } from '@playwright/test'

const objectiveCard = (page: Page) =>
  page.locator('section').filter({ has: page.getByRole('button', { name: 'Delete objective' }) })

test('a period is a record with a window, and an objective is committed for it', async ({ page }) => {
  await page.goto('/app?board=b-strategy')
  await expect(page.getByText('Strategy map')).toBeVisible()
  await page.getByRole('button', { name: 'Objectives', exact: true }).click()

  await expect(page.getByLabel('Period', { exact: true })).toBeVisible()
  // Creating a period is its own named action: a name and the window it covers.
  await page.getByRole('button', { name: 'New period' }).click()
  await page.getByLabel('New period', { exact: true }).fill('FY27 Q1')
  await page.getByLabel('New period start').fill('2027-01-01')
  await page.getByLabel('New period end').fill('2027-03-31')
  await page.getByRole('button', { name: 'Create period' }).click()

  // The form closes and the chosen period's window is what the header edits from now on.
  await expect(page.getByLabel('New period start')).toHaveCount(0)
  await expect(page.getByLabel('Period start')).toHaveValue('2027-01-01')
  await expect(page.getByLabel('Period end')).toHaveValue('2027-03-31')
  const created = page.getByLabel('Period', { exact: true }).locator('option', { hasText: 'FY27 Q1' })
  await expect(created).toHaveCount(1)

  await page.getByPlaceholder(/New objective in/).fill('A new period outcome')
  await page.getByRole('button', { name: 'New objective' }).click()
  await expect(objectiveCard(page).locator('input').first()).toHaveValue('A new period outcome')

  await page.reload()
  // The view is the place the URL names; after the reload it is already open.
  await expect(page.getByLabel('Period', { exact: true })).toBeVisible()
  // The period survives the reload as a record — its name and its window — not as a label copied
  // onto the objective.
  const reloaded = page.getByLabel('Period', { exact: true }).locator('option', { hasText: 'FY27 Q1' })
  await expect(reloaded).toHaveCount(1)
  await page.getByLabel('Period', { exact: true }).selectOption((await reloaded.getAttribute('value'))!)
  await expect(page.getByLabel('Period start')).toHaveValue('2027-01-01')
  await expect(page.getByLabel('Period end')).toHaveValue('2027-03-31')
  await expect(objectiveCard(page).locator('input').first()).toHaveValue('A new period outcome')
})
