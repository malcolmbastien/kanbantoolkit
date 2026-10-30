import { expect, test, type Page } from '@playwright/test'
import { openInstanceBoard } from './support'

/**
 * The workspace's words, on an instance.
 *
 * Types, templates, objectives and key results used to be written only by an import, so on a
 * deployment they lived in one browser and were gone at the next reload. This spec is the proof
 * that cannot come from a unit test: make one of each, reload a browser that holds nothing, and find
 * them — because they were never in the browser at all.
 *
 * An instance of its own, because the spec writes the whole vocabulary and a shared one would
 * rewrite what the account specs are reading.
 */

const ORIGIN = 'http://localhost:4180'
const MAYA = { email: 'maya.blake@example.com', name: 'Maya Blake' }
const BOARD = 'Team Atlas'

test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

/** The one objective card on screen — its title is the input the card is edited in. */
const objectiveCard = (page: Page) =>
  page.locator('section').filter({ has: page.getByRole('button', { name: 'Delete objective' }) })

/** The vocabulary write, and only one that landed: a debounced write that failed is not a save. */
const saved = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/workspace/vocabulary') &&
      response.request().method() === 'PUT' &&
      response.status() === 200,
  )

const home = async (page: Page, tab: 'Boards' | 'Templates') => {
  await page.goto(`${ORIGIN}/app?view=boards`)
  await page.getByRole('tab', { name: new RegExp(tab) }).click()
}

test('a type, a template and an objective outlive the browser', async ({ page }) => {
  await openInstanceBoard(page, ORIGIN, BOARD, MAYA)

  // A card type, made in Board settings — a workspace-wide word, not this board's.
  let landing = saved(page)
  await page.getByRole('button', { name: 'Settings' }).click()
  const settings = page.locator('[data-board-settings]')
  await settings.getByPlaceholder('Define a new card type…').fill('Probe Type')
  await settings.getByRole('button', { name: 'Add type' }).click()
  await expect(settings.getByText('Probe Type').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(settings).toHaveCount(0)
  await landing

  // A template, from the workspace home.
  await home(page, 'Templates')
  landing = saved(page)
  await page.getByRole('button', { name: /New template/ }).click()
  const editor = page.locator('[data-template-editor]')
  await editor.getByRole('textbox', { name: 'Template name' }).fill('Probe Design')
  await editor.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(page.getByRole('button', { name: /Probe Design/ })).toBeVisible()
  await landing

  // An objective, on a portfolio board — the one surface that reads them.
  await home(page, 'Boards')
  await page.getByRole('button', { name: 'New board' }).first().click()
  const creator = page.getByRole('dialog')
  await creator.getByLabel('New board name').fill('Strategy')
  await creator.getByRole('button', { name: /^Portfolio/ }).click()
  await creator.getByRole('button', { name: 'Create board' }).click()
  // The card lands on the home; opening it reads the portfolio: the strategy map, not its design.
  await page.getByRole('button', { name: /Strategy/ }).first().click()
  await expect(page.getByText('Strategy map')).toBeVisible()

  landing = saved(page)
  await page.getByRole('button', { name: 'Objectives', exact: true }).click()
  const objective = 'A probe objective'
  await page.getByPlaceholder(/New objective in/).fill(objective)
  await page.getByRole('button', { name: 'New objective' }).click()
  await expect(objectiveCard(page).locator('input').first()).toHaveValue(objective)
  await landing

  // Nothing above was in this browser's storage for the reload to keep: the account has it.
  await page.reload()
  await expect(page.getByRole('button', { name: /Maya Blake/ })).toBeVisible()

  await page.goto(`${ORIGIN}/app?view=boards`)
  await page.getByRole('button', { name: BOARD, exact: true }).first().click()
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.locator('[data-board-settings]').getByText('Probe Type').first()).toBeVisible()
  await page.keyboard.press('Escape')

  await home(page, 'Templates')
  await expect(page.getByRole('button', { name: /Probe Design/ })).toBeVisible()

  await home(page, 'Boards')
  await page.getByRole('button', { name: 'Strategy', exact: true }).first().click()
  await page.getByRole('button', { name: 'Objectives', exact: true }).click()
  await expect(objectiveCard(page).locator('input').first()).toHaveValue('A probe objective')
})

test('a second device sees the type the first one made', async ({ page, browser }) => {
  await openInstanceBoard(page, ORIGIN, BOARD, MAYA)

  const other = await browser.newContext()
  try {
    const second = await other.newPage()
    // A different browser with an empty store: everything it shows came from the instance.
    await openInstanceBoard(second, ORIGIN, BOARD, MAYA)

    await second.getByRole('button', { name: 'Settings' }).click()
    await expect(second.locator('[data-board-settings]').getByText('Probe Type').first()).toBeVisible()
  } finally {
    await other.close()
  }
})

test('a viewer is offered nothing that writes, and the server refuses it anyway', async ({ page, browser }) => {
  await openInstanceBoard(page, ORIGIN, BOARD, MAYA)

  // An invitation, as a viewer.
  await page.goto(`${ORIGIN}/app?view=boards`)
  await page.getByRole('button', { name: /^Admin/ }).click()
  await page.getByRole('tab', { name: 'Invitations' }).click()
  await page.getByRole('button', { name: 'Invite' }).click()
  const dialog = page.getByRole('dialog', { name: 'Invite somebody' })
  await dialog.getByPlaceholder('grace@example.com').fill('viewer@example.com')
  await dialog.getByRole('radio', { name: /Viewer/ }).check()
  await page.getByRole('button', { name: 'Make the link' }).click()
  const link = await page.getByLabel('Invitation link').inputValue()
  await page.getByRole('button', { name: 'Done' }).click()

  const other = await browser.newContext()
  try {
    const viewer = await other.newPage()
    await viewer.goto(link)
    await viewer.getByPlaceholder('you@example.com').fill('viewer@example.com')
    await viewer.getByRole('button', { name: 'Sign in as this address' }).click()
    await expect(viewer.getByRole('button', { name: /Viewer/ })).toBeVisible()

    // Nothing offers the settings that edit a workspace's words.
    await viewer.goto(`${ORIGIN}/app?view=boards`)
    await expect(viewer.getByText('This workspace is empty')).toHaveCount(0)
    await viewer.getByRole('button', { name: BOARD, exact: true }).first().click()
    await expect(viewer.locator('[data-workflow="cards"]')).toBeVisible()
    await expect(viewer.getByRole('button', { name: 'Settings' })).toHaveCount(0)

    // And the route itself says no: the interface hiding a control is not the rule.
    const workspace = (await (await viewer.request.get(`${ORIGIN}/api/workspace`)).json()) as {
      vocabularyRev?: number
      issueTypes: { id: string; name: string; color: string }[]
    }
    const refusal = await viewer.request.put(`${ORIGIN}/api/workspace/vocabulary`, {
      data: {
        rev: workspace.vocabularyRev ?? 0,
        issueTypes: workspace.issueTypes,
        boardTemplates: [],
        objectives: [],
        keyResults: [],
      },
    })
    expect(refusal.status()).toBe(403)
  } finally {
    await other.close()
  }
})
