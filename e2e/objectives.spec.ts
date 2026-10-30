import { expect, test, type Page } from '@playwright/test'

const objectiveCard = (page: Page) =>
  page.locator('section').filter({ has: page.getByRole('button', { name: 'Delete objective' }) })

test('a period is defined by typing it and adding an objective', async ({ page }) => {
  await page.goto('/app?board=b-strategy')
  await expect(page.getByText('Strategy map')).toBeVisible()
  await page.getByRole('button', { name: 'Objectives', exact: true }).click()

  const period = page.getByLabel('Period')
  await expect(period).toBeVisible()
  // There is no separate period record: typing one and adding an objective is how it exists.
  await period.fill('FY27 Q1')
  await page.getByPlaceholder(/New objective in/).fill('A new period outcome')
  await page.getByRole('button', { name: 'New objective' }).click()
  await expect(objectiveCard(page).locator('input').first()).toHaveValue('A new period outcome')

  await page.reload()
  // The view is the place the URL names; after the reload it is already open.
  await expect(page.getByLabel('Period')).toBeVisible()
  // The period survives the reload as a label on the objective, and is offered as an existing one.
  await expect(page.locator('#objective-periods option[value="FY27 Q1"]')).toHaveCount(1)
  await page.getByLabel('Period').fill('FY27 Q1')
  await expect(objectiveCard(page).locator('input').first()).toHaveValue('A new period outcome')
})
