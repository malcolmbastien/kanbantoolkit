import { expect, test, type Page } from '@playwright/test'

const objectiveCard = (page: Page) =>
  page.locator('section').filter({ has: page.getByRole('button', { name: 'Delete objective' }) })

test('a new period is created by its own action, and keeps its objective', async ({ page }) => {
  await page.goto('/app?board=b-strategy')
  await expect(page.getByText('Strategy map')).toBeVisible()
  await page.getByRole('button', { name: 'Objectives', exact: true }).click()

  await expect(page.getByLabel('Period')).toBeVisible()
  // Creating a period is its own named action, not a hidden property of the objective form.
  await page.getByRole('button', { name: 'New period' }).click()
  await page.getByLabel('New period').fill('FY27 Q1')
  await page.getByRole('button', { name: 'Create period' }).click()
  await expect(page.getByLabel('Period')).toHaveValue('FY27 Q1')
  await page.getByPlaceholder(/New objective in/).fill('A new period outcome')
  await page.getByRole('button', { name: 'New objective' }).click()
  await expect(objectiveCard(page).locator('input').first()).toHaveValue('A new period outcome')

  await page.reload()
  // The view is the place the URL names; after the reload it is already open.
  await expect(page.getByLabel('Period')).toBeVisible()
  // The period survives the reload as a label on the objective, and is offered as an existing one.
  await expect(page.getByLabel('Period').locator('option', { hasText: 'FY27 Q1' })).toHaveCount(1)
  await page.getByLabel('Period').selectOption('FY27 Q1')
  await expect(objectiveCard(page).locator('input').first()).toHaveValue('A new period outcome')
})
