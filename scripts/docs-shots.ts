/**
 * The pictures on the documentation pages, taken from the app that ships.
 *
 * The site has its own showcase (`scripts/shots.ts`); this is the guide's smaller, task-shaped set.
 * Every image is captured from the built `dist/` through Playwright, against the demo workspace, so
 * a picture cannot show a feature the app does not have, and the demo's names are the only people
 * in it.
 *
 *   npm run build && npm run docs:shots
 *
 * Images are written as WebP into `docs/img/guide/`. The docs and the generated wiki both point at
 * the same files; `scripts/publish-wiki.mjs` rewrites the relative path to a raw URL.
 */

import { chromium } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

const PORT = Number(process.env.DOCS_SHOTS_PORT ?? 4191)
const ORIGIN = `http://127.0.0.1:${PORT}`
const OUT = join(process.cwd(), 'docs', 'img', 'guide')
const VIEWPORT = { width: 1440, height: 1100 }
const MAX_WIDTH = 1200

/** The demo is a complete board; these are the places a guide needs to point at. */
async function waitForApp(page: Page, board: boolean): Promise<void> {
  await page.waitForFunction(
    (wantsBoard) => {
      const root = document.querySelector('#root')
      if (!root || root.childElementCount === 0) return false
      if (!wantsBoard) return document.body.innerText.trim().length > 200
      const cell = document.querySelector('[data-workflow="cards"] [data-lane-cell]')
      return Boolean(cell && cell.getBoundingClientRect().height > 10)
    },
    board,
    { timeout: 20_000 },
  )
  await page.waitForTimeout(450)
}

async function save(page: Page, name: string, target?: Locator, width = MAX_WIDTH, cropHeight?: number): Promise<void> {
  const png = target ? await target.screenshot({ type: 'png', animations: 'disabled' }) : await page.screenshot({ type: 'png', animations: 'disabled' })
  const file = join(OUT, `${name}.webp`)
  let image = sharp(png)
  if (cropHeight) {
    const meta = await image.metadata()
    image = image.extract({
      left: 0,
      top: 0,
      width: meta.width ?? 0,
      height: Math.min(meta.height ?? 0, Math.round(cropHeight * 2)),
    })
  }
  await image
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(file)
  const meta = await sharp(file).metadata()
  console.log(`  ${name}.webp — ${meta.width}×${meta.height}`)
}

/** A small Trello file for the import dialog; the dialog is the picture, not the cards. */
const IMPORT_FIXTURE = {
  name: 'Old Delivery Board',
  lists: [
    { id: 'l-todo', name: 'To Do' },
    { id: 'l-doing', name: 'Doing' },
    { id: 'l-done', name: 'Done' },
  ],
  members: [{ id: 'm-riley', fullName: 'Riley Kim' }],
  cards: [
    { id: 'c-1', name: 'First imported card', desc: 'A body.', idList: 'l-todo', labels: [{ name: 'imported' }], idMembers: ['m-riley'] },
    { id: 'c-2', name: 'Second imported card', idList: 'l-doing' },
    { id: 'c-3', name: 'Already done elsewhere', idList: 'l-done', dateLastActivity: '2026-09-01T10:00:00Z' },
  ],
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })

  const server = spawn(process.execPath, ['scripts/serve-dist.mjs'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  })

  // Wait for the host rather than guessing: a build that takes a second longer is not a failure.
  const deadline = Date.now() + 15_000
  for (;;) {
    try {
      const response = await fetch(`${ORIGIN}/app`)
      if (response.ok) break
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error('the built app did not start')
    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, colorScheme: 'light' })
  const page = await context.newPage()

  try {
    // 1. The board, at the whole width: the picture the guide opens on.
    await page.goto(`${ORIGIN}/app?board=b-atlas`)
    await waitForApp(page, true)
    await save(page, 'board-overview')

    // 2. The side drawer, opened on the card used throughout the guide. The panel is the picture,
    // not the board around it: the point is what a reader finds beside the work.
    await page.locator('[data-card-id="st-signup-rebuild"]').click()
    await page.locator('[data-item-panel]').waitFor()
    await page.waitForTimeout(300)
    await save(page, 'card-drawer', page.locator('[data-item-panel]'), 760)

    // 3. An initiative card: pips, the progress bar and the roll-up label in one place.
    await page.goto(`${ORIGIN}/app?board=b-atlas`)
    await waitForApp(page, true)
    const initiative = page.locator('[data-workflow="initiatives"] [data-card-id="init-signup-redesign"]')
    await initiative.scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    await save(page, 'initiative-rollup', initiative, 720)

    // 4. The boundary workflow is below the cards, and only exists because Atlas waits on Nova.
    const boundary = page.locator('[data-workflow="boundary"]')
    await boundary.scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    await save(page, 'boundary-workflow', boundary, 1000)

    // 5. The portfolio: the strategy map and the risk reading above it.
    await page.goto(`${ORIGIN}/app?board=b-strategy`)
    await waitForApp(page, false)
    await save(page, 'portfolio-overview')
    await save(page, 'portfolio-heatmap', page.locator('[data-portfolio-heatmap]'), 1100)

    // 6. The Flow view, with the demo's ten weeks of history behind it.
    await page.goto(`${ORIGIN}/app?board=b-atlas&view=flow`)
    await waitForApp(page, false)
    await save(page, 'flow-view')
    await page.locator('[data-forecast]').scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    await save(page, 'flow-planning')

    // 7. The keyboard sheet, opened the way a person opens it.
    await page.goto(`${ORIGIN}/app?board=b-atlas`)
    await waitForApp(page, true)
    await page.keyboard.press('Shift+Slash')
    const sheet = page.locator('[data-shortcuts-sheet]')
    await sheet.waitFor()
    await page.waitForTimeout(200)
    await save(page, 'keyboard-sheet', sheet, 900)

    // 8. A note with a mention, read in Activity where the mention is named.
    await page.goto(`${ORIGIN}/app?board=b-atlas`)
    await waitForApp(page, true)
    await page.locator('[data-card-id="st-signup-rebuild"]').click()
    const panel = page.locator('[data-item-panel]')
    await panel.getByLabel('Leave a note').fill('@Riley Kim can you review the copy?')
    await panel.getByLabel('Leave a note').press('Enter')
    await panel.getByRole('button', { name: 'Activity', exact: true }).click()
    await page.waitForTimeout(300)
    await save(page, 'mention-activity', panel, 760, 500)

    // 9. The import mapping step: a file read, but nothing written.
    await page.goto(`${ORIGIN}/app?view=boards`)
    await waitForApp(page, false)
    await page.getByRole('button', { name: /Import board/ }).click()
    const dialog = page.locator('[data-import-board-dialog]')
    await dialog.getByLabel('Import file').setInputFiles({
      name: 'trello-board.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(IMPORT_FIXTURE)),
    })
    await dialog.locator('[data-import-preview]').waitFor()
    await page.waitForTimeout(300)
    await save(page, 'import-mapping', dialog, 1000)

    // 10–11. The two administration surfaces need an account, so they are captured on a second,
    // throwaway instance with the development door open. The endpoint and copy are real to this
    // process and disappear with its temporary database.
    const accountDir = mkdtempSync(join(tmpdir(), 'kanbantoolkit-docs-'))
    const instancePort = Number(process.env.DOCS_ADMIN_PORT ?? 4196)
    const instance = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/index.node.ts'], {
      env: {
        ...process.env,
        PORT: String(instancePort),
        DB_PATH: join(accountDir, 'docs.db'),
        BACKUP_DIR: join(accountDir, 'backups'),
        STATIC_DIR: 'dist',
        AUTH_DEV: '1',
        LIVE: '0',
        MAIL_CONSOLE: '1',
      },
      stdio: 'ignore',
    })
    let accountContext: Awaited<ReturnType<typeof browser.newContext>> | undefined
    try {
      const accountOrigin = `http://127.0.0.1:${instancePort}`
      const accountDeadline = Date.now() + 20_000
      for (;;) {
        try {
          const response = await fetch(`${accountOrigin}/api/health`)
          if (response.ok) break
        } catch {
          // not listening yet
        }
        if (Date.now() > accountDeadline) throw new Error('the docs instance did not start')
        await new Promise((resolve) => setTimeout(resolve, 200))
      }

      accountContext = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, colorScheme: 'light' })
      const admin = await accountContext.newPage()
      await admin.goto(`${accountOrigin}/app`)
      await admin.getByPlaceholder('you@example.com').fill('docs-admin@example.com')
      await admin.getByRole('button', { name: 'Sign in as this address' }).click()
      await admin.getByRole('button', { name: /Docs Admin/ }).waitFor()
      await admin.goto(`${accountOrigin}/app?view=boards`)
      await admin.getByRole('button', { name: /^Admin/ }).click()
      await admin.getByRole('tab', { name: 'Webhooks' }).click()
      const webhooks = admin.locator('[data-webhooks-panel]')
      await webhooks.getByLabel('Endpoint URL').fill('https://example.com/kanban/events')
      await webhooks.getByRole('button', { name: 'Add endpoint' }).click()
      await admin.locator('[data-webhook-secret]').waitFor()
      // The secret is shown once, and the picture should not look like a place to copy one from.
      await admin.locator('[data-webhook-secret]').evaluate((element) => element.remove())
      await admin.waitForTimeout(250)
      await save(admin, 'webhooks-admin', webhooks, 1000)

      await admin.getByRole('tab', { name: 'Backups' }).click()
      const backups = admin.locator('[data-backups-panel]')
      await backups.getByRole('button', { name: 'Take a copy' }).click()
      await admin.getByText(/Copy taken:/).waitFor()
      await admin.waitForTimeout(250)
      await save(admin, 'backups-admin', backups, 1000)
    } finally {
      await accountContext?.close()
      instance.kill()
      rmSync(accountDir, { recursive: true, force: true })
    }
  } finally {
    await context.close()
    await browser.close()
    server.kill()
  }

  console.log(`docs shots: 13 written to docs/img/guide/`)
}

void main()
