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
  /** The card to open in the drawer first, when the picture is the panel. */
  card?: string
  /** Something to set up before the capture, such as a detail level or a lens. */
  prepare?: (page: Page) => Promise<void>
  /**
   * Keep only this many CSS pixels from the top of the capture. A drawer is taller than the frame
   * can show, and a picture of its whole length would shrink the words this shot exists for.
   */
  crop?: number
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
    name: 'blocked',
    path: '/app?board=b-atlas',
    // The "What's blocked" tab: a card whose block is a call-out, not a status word. The reason
    // sits at the top of the panel, in red, beside the Unblock control — the thing the tab names.
    card: 'st-enterprise-sso',
    pick: (page) => page.locator('[data-item-panel]'),
    // Down to the people and tags: the block, the reason and the card it belongs to, larger.
    crop: 565,
  },
  {
    name: 'summary',
    path: '/app?board=b-atlas',
    // The middle density: type, title, people, the due date at the foot and one badge.
    prepare: async (page) => {
      await page.getByRole('radio', { name: 'Summary' }).click()
      await page.waitForTimeout(400)
    },
  },
  {
    name: 'connections',
    path: '/app?board=b-atlas',
    // The lens that draws every hierarchy and dependency edge, boundary links included.
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Connections', exact: true }).click()
      await page.waitForTimeout(500)
    },
  },
  {
    name: 'portfolio',
    path: '/app?board=b-strategy',
    // A portfolio leads with its strategy map; objectives heading their own initiatives flow.
  },
  { name: 'flow', path: '/app?board=b-atlas&view=flow' },
  // The program dashboard: the team boards rolled up, and what needs attention.
  { name: 'flights', path: '/app?board=b-delivery&view=dashboard' },
]

/**
 * The home page's showcase shows one picture per tab, so those four are written twice: the full
 * capture, for the product page where a single shot is the subject, and a narrower copy for the
 * tabbed frame. The home page's transfer budget counts every image it names, and a 1440px capture
 * shown at 900 is bytes nobody sees.
 */
const SHOWCASE = ['board', 'lanes', 'initiatives', 'blocked', 'flow']

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
          // A board is drawn when a lane has height; a coordination board has no cards flow but
          // has its strategy map, and the Flow view speaks when its own surface is up.
          if (!board) return document.body.innerText.trim().length > 200
          const cell = document.querySelector('[data-workflow="cards"] [data-lane-cell]')
          if (cell && cell.getBoundingClientRect().height > 10) return true
          // A coordination board has no cards flow: a program reads its initiatives band and a
          // portfolio its strategy map. Flow and the dashboard have their own surfaces.
          return Boolean(
            document.querySelector(
              '[data-objective-group], [data-workflow="initiatives"], [data-flow-view], [data-attention-tile]',
            ),
          )
        },
        wantsBoard,
        { timeout: 20_000 },
      )
      await page.waitForTimeout(600)

      await shot.prepare?.(page)

      if (shot.card) {
        await page.locator(`[data-card-id="${shot.card}"]`).first().click()
        await page.locator('[data-item-panel]').waitFor()
        await page.waitForTimeout(400)
      }

      const target = shot.pick ? shot.pick(page).first() : page
      const png = await target.screenshot({ type: 'png', animations: 'disabled' })
      const file = join(OUT, `${shot.name}.webp`)
      let image = sharp(png)
      if (shot.crop) {
        const meta = await image.metadata()
        image = sharp(png).extract({
          left: 0,
          top: 0,
          width: meta.width ?? 0,
          height: Math.min(meta.height ?? 0, shot.crop),
        })
      }
      await image.webp({ quality: 74 }).toFile(file)
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
