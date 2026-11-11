import { expect, test, type Page } from '@playwright/test'

const objectiveCard = (page: Page) => page.locator('[data-objective-id]')

test('a period is a record with a window, and an objective is committed for it', async ({ page }) => {
  await page.goto('/app?board=b-strategy')
  await expect(page.getByText('Portfolio at a glance')).toBeVisible()
  await page.getByRole('button', { name: 'Edit objectives' }).click()

  await expect(page.getByLabel('Period', { exact: true })).toBeVisible()
  // Creating a period is its own named action: a name and the window it covers.
  await page.getByRole('button', { name: 'New period' }).click()
  await page.getByLabel('New period', { exact: true }).fill('FY27 Q1')
  await page.getByLabel('New period start').fill('2027-01-01')
  await page.getByLabel('New period end').fill('2027-03-31')
  await page.getByRole('button', { name: 'Create period' }).click()

  // The form closes and the new period has a header of its own: name, window and progress, not
  // three live fields waiting to be changed by accident.
  await expect(page.getByLabel('New period start')).toHaveCount(0)
  const periodHeader = page.locator('[data-period-header]')
  await expect(periodHeader).toContainText('FY27 Q1')
  await expect(periodHeader).toContainText('Starts')
  await expect(periodHeader).toContainText('Ends')
  await expect(periodHeader.getByText(/Day \d+ of \d+|Starts in \d+ days|Ended/)).toBeVisible()
  await expect(page.getByLabel('Period start')).toHaveCount(0)

  // Changing the window is an explicit act, behind Edit period.
  await page.getByRole('button', { name: 'Edit period' }).click()
  await expect(page.getByLabel('Period start')).toHaveValue('2027-01-01')
  await expect(page.getByLabel('Period end')).toHaveValue('2027-03-31')
  await page.getByLabel('Edit period name').fill('FY27 Q1 revised')
  await page.getByLabel('Period end').fill('2027-03-30')
  await page.getByRole('button', { name: 'Save period' }).click()
  await expect(periodHeader).toContainText('FY27 Q1 revised')
  await expect(page.getByLabel('Period start')).toHaveCount(0)
  const created = page.getByLabel('Period', { exact: true }).locator('option', { hasText: 'FY27 Q1 revised' })
  await expect(created).toHaveCount(1)

  await page.getByPlaceholder(/New objective in/).fill('A new period outcome')
  await page.getByRole('button', { name: 'New objective' }).click()
  await expect(page.getByLabel('Title of A new period outcome')).toHaveValue('A new period outcome')
  // The lifecycle is the four named states, each with its own coloured dot in the menu.
  const status = page.getByLabel('Status of A new period outcome')
  await expect(status).toContainText('Active')
  await status.click()
  const statusOptions = page.getByRole('listbox', { name: 'Status of A new period outcome' }).getByRole('option')
  await expect(statusOptions).toHaveText(['Draft', 'Active', 'Archived', 'Cancelled'])
  const dotColours = await statusOptions
    .locator('span.rounded-full')
    .evaluateAll((dots) => dots.map((dot) => getComputedStyle(dot).backgroundColor))
  expect(new Set(dotColours).size).toBe(4)
  await page.getByRole('option', { name: 'Archived' }).click()
  await expect(status).toContainText('Archived')
  await expect(page.getByText(/never counts as WIP/i)).toHaveCount(0)

  // An objective says what it means in its own words, and the words survive the reload.
  const description = page.getByLabel('Description of A new period outcome')
  await description.fill('A sentence about the outcome.')
  await expect(description).toHaveValue('A sentence about the outcome.')

  await page.reload()
  // The view is the place the URL names; after the reload it is already on the board. The
  // objectives editor is a mode on that board, so it is entered again.
  await expect(page.getByText('Portfolio at a glance')).toBeVisible()
  await page.getByRole('button', { name: 'Edit objectives' }).click()
  await expect(page.getByLabel('Period', { exact: true })).toBeVisible()
  // The period survives the reload as a record — its name and its window — not as a label copied
  // onto the objective.
  const reloaded = page.getByLabel('Period', { exact: true }).locator('option', { hasText: 'FY27 Q1 revised' })
  await expect(reloaded).toHaveCount(1)
  await page.getByLabel('Period', { exact: true }).selectOption((await reloaded.getAttribute('value'))!)
  await expect(page.getByLabel('Period start')).toHaveCount(0)
  await page.getByRole('button', { name: 'Edit period' }).click()
  await expect(page.getByLabel('Period start')).toHaveValue('2027-01-01')
  await expect(page.getByLabel('Period end')).toHaveValue('2027-03-30')
  await expect(page.getByLabel('Title of A new period outcome')).toHaveValue('A new period outcome')
  await expect(page.getByLabel('Description of A new period outcome')).toHaveValue('A sentence about the outcome.')
})

test('a mapped initiative names the details behind it', async ({ page }) => {
  await page.goto('/app?board=b-strategy')
  await page.getByRole('button', { name: 'Edit objectives' }).click()

  // The initiative carries its own reading: kind, progress, the board that owns it, its children
  // and the people on it — not only a title and a percentage.
  const card = objectiveCard(page).filter({ has: page.getByRole('button', { name: 'Recurring revenue engine' }) })
  await expect(card).toContainText('Recurring revenue engine')
  await expect(card).toContainText('No kind')
  await expect(card).toContainText('Program · Digital line of business')
  await expect(card).toContainText('1 child')
  await expect(card).toContainText('Maya Blake')
})

test('objectives reorder within their period, and the order survives a reload', async ({ page }) => {
  await page.goto('/app?board=b-strategy')
  await page.getByRole('button', { name: 'Edit objectives' }).click()

  const order = () =>
    page.locator('[data-objective-id]').evaluateAll((cards) => cards.map((card) => card.getAttribute('data-objective-id')))
  await expect(page.locator('[data-objective-id]')).toHaveCount(3)
  expect(await order()).toEqual(['obj-activation', 'obj-reliability', 'obj-efficiency'])

  // The map sorts objectives by title until somebody gives them an order; one move gives this one
  // the first place, which is also the state a reload has to keep.
  await page.getByRole('button', { name: 'Move Reduce cost to serve up' }).click()
  expect(await order()).toEqual(['obj-efficiency', 'obj-activation', 'obj-reliability'])
  // The glance above reads in the same order as the board.
  await expect
    .poll(() =>
      page.locator('[data-portfolio-row]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-portfolio-row'))),
    )
    .toEqual(['obj-efficiency', 'obj-activation', 'obj-reliability'])
  // The card now first in its period cannot move up, and the one last cannot move down.
  await expect(page.getByRole('button', { name: 'Move Reduce cost to serve up' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Move Reduce cost to serve down' })).toBeEnabled()

  await page.reload()
  await expect(page.getByText('Portfolio at a glance')).toBeVisible()
  await page.getByRole('button', { name: 'Edit objectives' }).click()
  await expect(page.locator('[data-objective-id]')).toHaveCount(3)
  expect(await order()).toEqual(['obj-efficiency', 'obj-activation', 'obj-reliability'])
  await expect
    .poll(() =>
      page.locator('[data-portfolio-row]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-portfolio-row'))),
    )
    .toEqual(['obj-efficiency', 'obj-activation', 'obj-reliability'])
})

test('edit objectives adds a key result and deletes an objective in place', async ({ page }) => {
  await page.goto('/app?board=b-strategy')
  await page.getByRole('button', { name: 'Edit objectives' }).click()

  const activation = page.locator('[data-objective-id="obj-activation"]')
  await activation.getByPlaceholder('Add a key result…').fill('A probe key result')
  await activation.getByRole('button', { name: 'Add' }).click()
  await expect
    .poll(() => activation.locator('input').evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value)))
    .toContain('A probe key result')

  const reliability = page.locator('[data-objective-id="obj-reliability"]')
  await reliability.getByRole('button', { name: 'Map an initiative' }).click()
  await page.getByRole('combobox', { name: 'Search initiatives' }).press('Enter')
  await expect(reliability).toContainText('1 mapped')

  await reliability.getByRole('button', { name: 'Delete Improve reliability' }).click()
  await expect(page.locator('[data-objective-id="obj-reliability"]')).toHaveCount(0)
})
