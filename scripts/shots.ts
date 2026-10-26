/**
 * The pictures on the site, taken from the app that ships.
 *
 * A screenshot that shows something the app does not do is a bug in the page, not in the picture —
 * so these are captured from the built `dist/`, driven by Playwright, and written as WebP into
 * `site/img/`. Nothing here is drawn by hand and nothing is a mock-up (task 152, R3).
 *
 *   npm run shots      # after `npm run build`
 *
 * The app is the demo: it seeds itself on a fresh origin, so "no account" is how the pictures are
 * taken, which is also how the site's reader will see them.
 */

import { chromium } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const PORT = Number(process.env.SHOTS_PORT ?? 4188)
const ORIGIN = `http://127.0.0.1:${PORT}`
const OUT = join(process.cwd(), 'site/img')

/**
 * The viewport the pictures are composed at.
 *
 * Tall, because the board is: the initiatives flow sits above the team's columns and both are the
 * point, so the picture is a board rather than a header.
 */
const VIEWPORT = { width: 1440, height: 1200 }

interface Shot {
  name: string
  /** Where in the app it is taken. */
  path: string
  /** The element, when the picture is a part of the board rather than the whole of it. */
  pick?: (page: Page) => Locator
}

const SHOTS: Shot[] = [
  { name: 'board', path: '/app?board=b-atlas' },
  {
    name: 'lanes',
    path: '/app?board=b-atlas',
    // The team's own columns, with their cards — the thing the four stages are for.
    pick: (page) => page.locator('[data-workflow="cards"]'),
  },
  {
    name: 'initiatives',
    path: '/app?board=b-atlas',
    // The initiatives flow, by its heading: the rollups only make sense beside the work.
    pick: (page) =>
      page.locator('section').filter({ has: page.getByRole('heading', { name: 'Initiatives workflow' }) }),
  },
  {
    name: 'drawer',
    path: '/app?board=b-atlas',
    pick: (page) => page.locator('[data-item-panel]'),
  },
  { name: 'flights', path: '/app?view=dashboard' },
]

/**
 * The home page's showcase shows one picture per tab, so those four are written twice: the full
 * capture, for the product page where a single shot is the subject, and a narrower copy for the
 * tabbed frame. The home page's transfer budget counts every image it names, and a 1440px capture
 * shown at 900 is bytes nobody sees.
 */
const SHOWCASE = ['board', 'lanes', 'initiatives', 'drawer']

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })

  // The build, served by the same forty-line host the e2e uses: the app is at `/app`, and a
  // screenshot must be of the thing a person would see.
  const server = spawn(process.execPath, ['scripts/serve-dist.mjs'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  })
  await new Promise((resolve) => setTimeout(resolve, 600))

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 })

  try {
    for (const shot of SHOTS) {
      await page.goto(`${ORIGIN}${shot.path}`)
      // The board has drawn when a lane has height — the app fills the window, so a lane with a
      // real box is a board with its work in it. Waiting on an element's *visibility* would pass on
      // the initiative cards before the columns beneath them have laid out.
      const wantsBoard = shot.path.includes('board=')
      await page.waitForFunction(
        (board) => {
          const root = document.querySelector('#root')
          if (!root || root.childElementCount === 0) return false
          // A board is drawn when a lane has height; any other screen when it has said something.
          if (!board) return document.body.innerText.trim().length > 200
          const cell = document.querySelector('[data-workflow="cards"] [data-lane-cell]')
          return Boolean(cell && cell.getBoundingClientRect().height > 10)
        },
        wantsBoard,
        { timeout: 20_000 },
      )
      await page.waitForTimeout(600)

      if (shot.pick && shot.name === 'drawer') {
        await page.locator('[data-workflow="cards"] [data-card-id]').first().click()
        await page.locator('[data-item-panel]').waitFor()
        await page.waitForTimeout(400)
      }

      const target = shot.pick ? shot.pick(page).first() : page
      const png = await target.screenshot({ type: 'png', animations: 'disabled' })
      const file = join(OUT, `${shot.name}.webp`)
      await sharp(png).webp({ quality: 74 }).toFile(file)
      const size = (await sharp(file).metadata()).width
      console.log(`  ${shot.name}.webp — ${size}px wide`)
    }
  } finally {
    await browser.close()
    server.kill()
  }

  // The same four pictures at the width the home page's frame draws them. 1000px is enough for a
  // 58rem frame on a 2x screen at the size the tab shows; quality 72 is the point where the board's
  // column rules still read.
  for (const name of SHOWCASE) {
    const file = join(OUT, `home-${name}.webp`)
    await sharp(join(OUT, `${name}.webp`))
      .resize({ width: 1000, withoutEnlargement: true })
      .webp({ quality: 72 })
      .toFile(file)
    const meta = await sharp(file).metadata()
    console.log(`  home-${name}.webp — ${meta.width}px wide`)
  }

  console.log(`shots: ${SHOTS.length} written to site/img/`)
}

void main()
