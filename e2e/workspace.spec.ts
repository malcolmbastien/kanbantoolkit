import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { addCardTo, openBoard } from './support'

/**
 * The workspace as a file. The interesting question is not whether Export produces a download —
 * it is whether that download *is* the workspace, so each test edits something first and compares
 * what comes back.
 */

/** The Boards screen, where the workspace's files live. */
async function openWorkspace(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Flowline' }).click()
  await expect(page.getByText('Every board in the organisation')).toBeVisible()
}

/** The workspace as the browser holds it: the board names and how many items there are. */
async function stored(page: Page): Promise<{ boards: string[]; items: number }> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem('flowline-state-v3')
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
    expect(backup.app).toBe('flowline')
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
        name: 'flowline.json',
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

  await expect(page.getByText(/not a Flowline workspace/i)).toBeVisible()
  expect(await stored(page)).toEqual(before)
})
