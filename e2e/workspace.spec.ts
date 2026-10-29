import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { addCardTo, openBoard } from './support'

/**
 * The workspace as a file. The interesting question is not whether Export produces a download —
 * it is whether that download *is* the workspace, so each test edits something first and compares
 * what comes back.
 */

/**
 * The demo, reset.
 *
 * Starting the demo over is not a thing you do to a board — it replaces the whole workspace this
 * browser holds — so it lives in the admin screen, beside the copies and the storage. This walks
 * the arc: gone from the toolbar, found in Admin, and actually reset.
 */
test('the app opens on the workspace home', async ({ page }) => {
  await page.goto('/app')

  // The default place is the workspace home — every board — not a board's own flow.
  await expect(page.getByRole('heading', { name: 'Workspace Home' })).toBeVisible()
  await expect(page.getByText('Every board in the organisation')).toBeVisible()
  await expect(page.locator('[data-workflow]')).toHaveCount(0)
  // OKRs are a portfolio board's own work, not a banner on the organisation's home.
  await expect(page.getByText('Objectives & Key Results')).toHaveCount(0)
})

test('a template opens from its card', async ({ page }) => {
  await page.goto('/app')
  await expect(page.getByRole('heading', { name: 'Workspace Home' })).toBeVisible()

  // Templates have their own tab, so a workspace with many boards does not bury them.
  await page.getByRole('tab', { name: /Templates/ }).click()

  const card = page.getByRole('button', { name: /Feature Flow/ })
  await expect(card).toBeVisible()
  await card.click()

  const dialog = page.getByRole('dialog', { name: 'Template: Feature Flow' })
  await expect(dialog).toBeVisible()
  // Everything about the template is in one place: its name, its design, edit and delete.
  await expect(dialog.getByRole('button', { name: 'Template name' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Edit' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Delete template' })).toBeVisible()
  await expect(dialog.getByText('Board type')).toBeVisible()
})

test('New template opens the template editor, and Cancel discards it', async ({ page }) => {
  await page.goto('/app')
  await page.getByRole('tab', { name: /Templates/ }).click()

  // Cancel takes the just-made template back out.
  await page.getByRole('button', { name: /New template/ }).click()
  const dialog = page.locator('[data-template-editor]')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Template name' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Untitled template/ })).toHaveCount(0)

  // Done keeps it. The same editor sets its name, type, flow and card types.
  await page.getByRole('button', { name: /New template/ }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox', { name: 'Template name' }).fill('Probe Design')
  await dialog.getByLabel('Template board type').selectOption('program')
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const card = page.getByRole('button', { name: /Probe Design/ })
  await expect(card).toBeVisible()
  await expect(card).toContainText('Program')
})

test('None is a card type, always offered', async ({ page }) => {
  await openBoard(page)
  const card = page.locator('[data-workflow="cards"] [data-card-id]').first()
  await card.click()

  const panel = page.locator('[data-item-panel]')
  await panel.getByLabel('Type').selectOption('t-none')
  await expect(panel.getByLabel('Type')).toHaveValue('t-none')
  await page.keyboard.press('Escape')
  await expect(card).toContainText('None')
})

test('objectives open from a portfolio board, not the top bar', async ({ page }) => {
  await openBoard(page)
  // A team board offers no global Objectives tab.
  await expect(page.getByRole('button', { name: 'Objectives', exact: true })).toHaveCount(0)

  // The portfolio board has the one entry: its own Strategy map.
  await page.goto('/app?board=b-strategy')
  await expect(page.getByText('Strategy map')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Objectives', exact: true })).toBeVisible()
})

test('the demo is reset from the admin screen, not from the board toolbar', async ({ page }) => {
  await openBoard(page)

  // The board's toolbar is for the board. There is no Reset beside Edit board any more.
  await expect(page.getByRole('button', { name: 'Reset', exact: true })).toHaveCount(0)

  // Make one change that the demo does not have, so the reset has something to undo.
  const [renamed] = await page.locator('[data-workflow="cards"] [data-card-id]').evaluateAll((elements) =>
    elements.map((element) => (element as HTMLElement).dataset.cardId!),
  )
  await page.locator(`[data-card-id="${renamed}"]`).click()
  await page.getByLabel('Title').fill('A card the demo does not have')
  await page.keyboard.press('Escape')
  await expect(page.locator(`[data-card-id="${renamed}"]`)).toContainText('A card the demo does not have')

  // The admin screen holds it, and says what it does before it does it.
  await page.goto('/app?view=admin')
  const demo = page.locator('[data-demo-reset]')
  await expect(demo).toBeVisible()
  await demo.getByRole('button', { name: 'Reset to the demo…' }).click()
  await expect(page.getByRole('dialog', { name: 'Start the demo over?' })).toBeVisible()
  await page.getByRole('button', { name: 'Reset the demo' }).click()

  // The workspace is the demo's again: the change is gone, and the demo's own board is back.
  await expect(async () => {
    const state = await stored(page)
    expect(state.items).toBeGreaterThan(0)
  }).toPass()
  await page.getByRole('button', { name: 'Kanban Toolkit' }).click()
  await expect(page.getByText('Every board in the organisation')).toBeVisible()
  await openBoard(page)
  await expect(page.locator(`[data-card-id="${renamed}"]`)).not.toContainText('A card the demo does not have')
})

/** The workspace data panel, now in Admin: the home is for browsing boards. */
async function openWorkspace(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Kanban Toolkit' }).click()
  await expect(page.getByText('Every board in the organisation')).toBeVisible()
  await page.getByRole('button', { name: 'Admin' }).click()
  await page.getByRole('tab', { name: 'Workspace data' }).click()
  await expect(page.getByRole('heading', { name: 'Workspace data' })).toBeVisible()
}

/** The workspace as the browser holds it: the board names and how many items there are. */
async function stored(page: Page): Promise<{ boards: string[]; items: number }> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem('kanbantoolkit-state-v3')
    const state = raw
      ? (JSON.parse(raw) as { state?: { boards?: { name: string }[]; items?: unknown[] } }).state
      : undefined
    return {
      boards: (state?.boards ?? []).map((board) => board.name),
      items: (state?.items ?? []).length,
    }
  })
}

test('the exported file is the workspace, and importing it into a clean origin restores it', async ({ browser, baseURL }) => {
  const first = await browser.newContext({ baseURL })
  try {
    const a = await first.newPage()
    await openBoard(a)
    // One change, so the round trip proves the file rather than the demo both contexts share.
    await addCardTo(a, 'Backlog')
    const exported = await stored(a)
    await openWorkspace(a)

    const pending = a.waitForEvent('download')
    await a.getByRole('button', { name: 'Export' }).click()
    const download = await pending
    const text = await readFile((await download.path())!, 'utf8')
    const backup = JSON.parse(text) as {
      app: string
      version: number
      state: { boards: { name: string }[]; items: unknown[] }
    }
    expect(backup.app).toBe('kanbantoolkit')
    expect(backup.state.items).toHaveLength(exported.items)
    expect(backup.state.boards.map((board) => board.name)).toEqual(exported.boards)

    // A clean origin: the demo, not the first context's extra card.
    const second = await browser.newContext({ baseURL })
    try {
      const b = await second.newPage()
      await openBoard(b)
      expect((await stored(b)).items).not.toBe(exported.items)

      await openWorkspace(b)
      await b.locator('input[type="file"]').setInputFiles({
        name: 'kanbantoolkit.json',
        mimeType: 'application/json',
        buffer: Buffer.from(text),
      })
      await b.locator('[role="dialog"]').getByRole('button', { name: 'Import' }).click()

      await expect.poll(async () => (await stored(b)).items).toBe(exported.items)
      expect((await stored(b)).boards).toEqual(exported.boards)
    } finally {
      await second.close()
    }
  } finally {
    await first.close()
  }
})

test('a file that is not a workspace is refused, and changes nothing', async ({ page }) => {
  await openBoard(page)
  await openWorkspace(page)
  const before = await stored(page)

  await page.locator('input[type="file"]').setInputFiles({
    name: 'not-a-workspace.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"nope":true}'),
  })

  await expect(page.getByText(/not a Kanban Toolkit workspace/i)).toBeVisible()
  expect(await stored(page)).toEqual(before)
})
