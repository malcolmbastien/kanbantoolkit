/**
 * The moving picture in the README.
 *
 * The stills on the site are taken from the app that ships (`scripts/shots.ts`), and a GIF of a
 * feature the app no longer has is the same bug in a heavier file. So this is the same rule for the
 * picture that answers "what is this?" in the repository's first screenful: drive the built app with
 * a real pointer, record it, and write `docs/img/demo.gif`.
 *
 *   npm run build && npm run demo
 *
 * It needs `ffmpeg` on the path — the encode is a palette pass, because a default GIF of a UI is
 * either enormous or banded, and the board's tinted lanes punish both.
 *
 * The shape of the clip is the product in one gesture: a card leaves Backlog, lands in a column of
 * In Progress, and the counts move. Then the card's own record opens beside it.
 */

import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const PORT = Number(process.env.DEMO_PORT ?? 4189)
const ORIGIN = `http://127.0.0.1:${PORT}`
const RAW = join('node_modules', '.tmp', 'demo')
const OUT = join('docs', 'img', 'demo.gif')
const VIEWPORT = { width: 1200, height: 700 }

/** The one command this needs and does not carry: installed, or named so the fix is obvious. */
function ffmpeg(args: string[]): void {
  const done = spawnSync('ffmpeg', args, { stdio: 'inherit' })
  if (done.error) throw new Error('ffmpeg is not on the path — install it, then run this again')
  if (done.status !== 0) throw new Error(`ffmpeg exited ${done.status}`)
}

async function main(): Promise<void> {
  mkdirSync(RAW, { recursive: true })
  // The build, served by the same host the e2e and the stills use.
  const server = spawn(process.execPath, ['scripts/serve-dist.mjs'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  })
  await new Promise((resolve) => setTimeout(resolve, 600))

  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: VIEWPORT, recordVideo: { dir: RAW, size: VIEWPORT } })
  const page = await context.newPage()

  try {
    await page.goto(`${ORIGIN}/app?board=b-atlas`)
    await page.waitForSelector('[data-workflow="cards"]')
    // The cards workflow fills the frame: the initiatives are a scroll away, and this clip is about
    // a card moving.
    await page.evaluate(() => {
      const scroller = document.querySelector('[data-board-scroll]')
      const cards = document.querySelector('[data-workflow="cards"]')
      if (scroller && cards) scroller.scrollTop = cards.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    })
    await page.waitForTimeout(700)

    const card = page.locator('[data-card-id="st-usage-billing"]')
    const from = await card.boundingBox()
    const to = await page
      .locator('[data-workflow="cards"] [data-lane-cell]')
      .filter({ hasText: 'Dev' })
      .first()
      .boundingBox()
    if (!from || !to) throw new Error('the demo board did not draw the card or the column')

    // A press, a drag, a release — stepped, because a GIF of a card teleporting says nothing.
    await page.mouse.move(from.x + from.width / 2, from.y + 22)
    await page.mouse.down()
    const steps = 26
    for (let step = 1; step <= steps; step++) {
      const x = from.x + from.width / 2 + ((to.x + to.width / 2 - (from.x + from.width / 2)) * step) / steps
      const y = from.y + 22 + ((to.y + 150 - (from.y + 22)) * step) / steps
      await page.mouse.move(x, y)
      await page.waitForTimeout(22)
    }
    await page.waitForTimeout(200)
    await page.mouse.up()
    await page.waitForTimeout(1100)

    await page.locator('[data-card-id="st-signup-rebuild"]').click()
    await page.waitForTimeout(2000)
  } finally {
    await context.close()
    await browser.close()
    server.kill()
  }

  // The recorder names its file after the page it recorded, so the clip is found rather than
  // assumed — there is exactly one per run.
  const [clip] = readdirSync(RAW).filter((name) => name.endsWith('.webm'))
  if (!clip) throw new Error('the recorder wrote no clip')

  // The palette is taken from the clip itself, and 112 colours is where the lanes stop banding
  // without the file doubling. 880px and 10fps read cleanly at the width the README shows.
  ffmpeg([
    '-y',
    '-v', 'error',
    '-ss', '0.35',
    '-t', '5.55',
    '-i', join(RAW, clip),
    '-vf', 'fps=10,scale=880:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=112[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
    '-loop', '0',
    OUT,
  ])
  rmSync(RAW, { recursive: true, force: true })
  console.log(`demo: ${OUT}`)
}

void main()
