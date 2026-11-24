import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { addCardTo, laneRegion, openBoard } from './support'

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

  // A portfolio is read for its objectives: no dashboard or timeline shortcuts on its card.
  const portfolioCard = page.locator('[data-board-card="b-strategy"]')
  await expect(portfolioCard).toBeVisible()
  await expect(portfolioCard.getByTitle(/Open .*'s dashboard/)).toHaveCount(0)
  await expect(portfolioCard.getByTitle(/Open .*'s timeline/)).toHaveCount(0)
  await expect(page.locator('[data-board-card="b-atlas"]').getByTitle(/Open .*'s dashboard/)).toHaveCount(1)
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
  await expect(dialog.getByRole('heading', { name: 'Feature Flow' })).toBeVisible()
  // A design is read for what it would build: the board is one action, beside Edit.
  await expect(dialog.getByRole('button', { name: 'Use template' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Edit' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Delete template' })).toBeVisible()
  await expect(dialog.getByText('Board type')).toBeVisible()
  // The initiatives flow is fixed at the top, above the cards flows.
  await expect(dialog.locator('[data-template-flow]').first()).toContainText('Initiatives')

  // Editing is a draft held behind Save/Cancel, not a one-way Done.
  await dialog.getByRole('button', { name: 'Edit' }).click()
  // The name is in the draft too, so it is editable only while editing.
  await expect(dialog.getByRole('button', { name: 'Template name' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Edit' })).toBeVisible()
})

test('a template makes a board, instead of a dropdown in the new-board dialog', async ({ page }) => {
  await page.goto('/app')
  await expect(page.getByRole('heading', { name: 'Workspace Home' })).toBeVisible()

  // The new-board dialog asks for a name and a type. It does not ask which design to use: that is
  // a choice of its own, made where the designs are read.
  await page.getByRole('button', { name: 'New board' }).first().click()
  const blank = page.getByRole('dialog', { name: 'New board' })
  await expect(blank).toBeVisible()
  await expect(blank.getByLabel('New board template')).toHaveCount(0)
  await blank.getByRole('button', { name: /Start from a template/ }).click()
  await expect(page.getByRole('tab', { name: /Templates/ })).toHaveAttribute('aria-selected', 'true')

  // The collection ships with the app, and a card offers the act a template exists for.
  const card = page.locator('[data-template-card="tpl-upstream-kanban"]')
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'Use template' }).click()

  const dialog = page.getByRole('dialog', { name: 'New board from template' })
  await expect(dialog).toContainText('Upstream Kanban')
  await dialog.getByLabel('New board name').fill('Upstream and downstream')
  await dialog.getByRole('button', { name: 'Create board' }).click()

  // One cards flow, drawn as one workflow: discovery and delivery in the same four stages.
  await expect(page.locator('[data-flow-band][data-flow-name="End to end"]')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-flow-band][data-flow-name="Downstream"]')).toHaveCount(0)
  for (const name of ['Idea', 'Value analysis', 'Concept', 'Incoming', 'Ready to Pull', 'Next', 'Being Pulled', 'Analysis', 'Development', 'Test', 'UAT', 'Pulled', 'Ready to Deploy']) {
    await expect(laneRegion(page, name, 'End to end')).toBeVisible()
  }
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

  // Save keeps it. The same editor sets its name, type, flow, initiative kinds and card types.
  await page.getByRole('button', { name: /New template/ }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox', { name: 'Template name' }).fill('Probe Design')
  // Templates describe what a team draws and what a program arranges; a portfolio is a reading of
  // the work, not a design of its own.
  await dialog.getByLabel('Template board type').selectOption('program')
  await dialog.getByLabel('New initiative kind name').fill('Bet')
  await dialog.getByRole('button', { name: 'Add kind' }).click()
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const card = page.getByRole('button', { name: /Probe Design/ })
  await expect(card).toBeVisible()
  await expect(card).toContainText('Program')

  // The kind was part of the draft, so it is part of the saved design.
  await card.click()
  const saved = page.getByRole('dialog', { name: 'Template: Probe Design' })
  await expect(saved.getByText('Initiative kinds')).toBeVisible()
  await expect(saved.getByText('Bet', { exact: true })).toBeVisible()
})

test('None is a card type, always offered', async ({ page }) => {
  await openBoard(page)
  const card = page.locator('[data-workflow="cards"] [data-card-id]').first()
  await card.click()

  const panel = page.locator('[data-item-panel]')
  const type = panel.getByRole('button', { name: /^Type:/ })
  await type.click()
  await panel.getByRole('option', { name: 'None' }).click()
  await expect(type).toHaveAttribute('data-type-id', 't-none')
  await expect(type).toContainText('None')
  await page.keyboard.press('Escape')
  // No type is the absence of a badge, not the word "None" on the face.
  await expect(card).not.toContainText('None')
})

test('objectives live on the portfolio board, not in the top bar', async ({ page }) => {
  await openBoard(page)
  // No board has a separate Objectives screen.
  await expect(page.getByRole('button', { name: 'Objectives', exact: true })).toHaveCount(0)

  await page.goto('/app?board=b-strategy')
  await expect(page.getByText('Portfolio at a glance')).toBeVisible()
  await expect(page.getByRole('banner').getByRole('button', { name: 'Objectives', exact: true })).toHaveCount(0)
  // There is no separate workflow header, and mapping is an editing act.
  await expect(page.getByText('Strategy map')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Map an initiative' })).toHaveCount(0)
  // Board is the only view, so even its tab is gone; the board picker remains.
  await expect(page.getByRole('banner').getByRole('button', { name: 'Board', exact: true })).toHaveCount(0)
  // A portfolio is read for objectives, not for the board reports underneath it.
  for (const name of ['Dashboard', 'Timeline', 'Archive']) {
    await expect(page.getByRole('banner').getByRole('button', { name, exact: true })).toHaveCount(0)
  }

  // Editing OKRs is a mode on the map itself: the period controls and the in-place editors appear.
  await page.getByRole('button', { name: 'Edit objectives' }).click()
  await expect(page.getByLabel('Period', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Map an initiative' }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText('Portfolio at a glance')).toBeVisible()
})

test('the demo is reset from the workspace home, and the demo has no Admin section', async ({ page }) => {
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

  // The workspace home holds it now, and says what it does before it does it. The demo has no
  // Admin section: its data screen is called Workspace data and is about this browser's copy.
  await page.getByRole('button', { name: 'Kanban Toolkit' }).click()
  await expect(page.getByText('Every board in the organisation')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Admin', exact: true })).toHaveCount(0)
  const reset = page.getByRole('button', { name: 'Reset demo data' })
  await expect(reset).toBeVisible()
  await reset.click()
  await expect(page.getByRole('dialog', { name: 'Start the demo over?' })).toBeVisible()
  await page.getByRole('button', { name: 'Reset the demo' }).click()

  // The workspace is the demo's again: the change is gone, and the demo's own board is back.
  await expect(async () => {
    const state = await stored(page)
    expect(state.items).toBeGreaterThan(0)
  }).toPass()
  await openBoard(page)
  await expect(page.locator(`[data-card-id="${renamed}"]`)).not.toContainText('A card the demo does not have')
})

/** The workspace data panel, now in Admin: the home is for browsing boards. */
async function openWorkspace(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Kanban Toolkit' }).click()
  await expect(page.getByText('Every board in the organisation')).toBeVisible()
  await page.getByRole('button', { name: 'Workspace data' }).click()
  await page.getByRole('tab', { name: 'Workspace data' }).click()
  await expect(page.getByRole('heading', { name: 'Workspace data', level: 1 })).toBeVisible()
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

test('a template can carry a second cards flow, and keeps it', async ({ page }) => {
  await page.goto('/app')
  await page.getByRole('tab', { name: /Templates/ }).click()
  await page.getByRole('button', { name: /New template/ }).click()

  const dialog = page.locator('[data-template-editor]')
  await dialog.getByRole('textbox', { name: 'Template name' }).fill('Two flows')
  // A template is a set of flows: it starts with its cards flow and its initiatives flow, and
  // another cards flow arrives with its own four columns.
  await dialog.getByRole('button', { name: 'Add a cards flow' }).click()
  await expect(dialog.locator('[data-template-flow]')).toHaveCount(3)
  await dialog.getByRole('button', { name: 'Rename Cards 2' }).click()
  await dialog.getByRole('textbox', { name: 'Rename Cards 2' }).fill('Support')
  await page.keyboard.press('Enter')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()

  // Opening it again: both cards flows, named, each with its tree — and the initiatives flow.
  await page.getByRole('button', { name: /Two flows/ }).click()
  const reopened = page.getByRole('dialog', { name: 'Template: Two flows' })
  await expect(reopened.locator('[data-template-flow]')).toHaveCount(3)
  await expect(reopened.getByText('Cards', { exact: true })).toBeVisible()
  await expect(reopened.getByText('Support', { exact: true })).toBeVisible()
  await expect(reopened.getByText('Initiatives', { exact: true })).toBeVisible()
})

test('the All board filter counts the whole list, not the selected band', async ({ page }) => {
  await page.goto('/app')
  const filters = page.getByRole('group', { name: 'Filter boards by type' })
  const all = filters.getByRole('button', { name: /^All/ })
  const before = (await all.textContent()) ?? ''
  expect(before).toMatch(/^All\d+$/)

  await filters.getByRole('button', { name: /^Team/ }).click()
  await expect(all).toHaveText(before)
  await expect(filters.getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'false')
})
