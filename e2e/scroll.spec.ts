import { expect, test } from '@playwright/test'

/**
 * The page does not jump when its height changes under the reader.
 *
 * A board's height is its tallest column, so opening a drawer (the board narrows and every card
 * reflows taller) or moving a card between columns changes the height of the page while nobody asked
 * the view to move. `useStillScroll` holds the first card in view where it is; these are its two
 * cases — a change above the fold with the reader mid-page, and a move with the reader at the
 * bottom, where the scroll is already at its end and a reflow must not pull it away.
 */

const VIEWPORT = { width: 1400, height: 900 }

/** The board's own scroller, and where it is. */
async function scrollState(page: import('@playwright/test').Page) {
  return page.locator('[data-board-scroll]').evaluate((el) => ({
    top: el.scrollTop,
    height: el.scrollHeight,
    client: el.clientHeight,
    distance: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight),
  }))
}

/** The first card wholly in view — the thing a reader's eye is on. */
async function anchorCard(page: import('@playwright/test').Page) {
  return page.locator('[data-board-scroll]').evaluate((box) => {
    const bounds = box.getBoundingClientRect()
    const card = [...box.querySelectorAll<HTMLElement>('[data-workflow] [data-card-id]')].find((c) => {
      const rect = c.getBoundingClientRect()
      return rect.top >= bounds.top - 1 && rect.top < bounds.bottom - 40
    })
    return card ? { id: card.dataset.cardId!, y: Math.round(card.getBoundingClientRect().top) } : null
  })
}

const cardY = (page: import('@playwright/test').Page, id: string) =>
  page.locator(`[data-card-id="${id}"]`).evaluate((el) => Math.round(el.getBoundingClientRect().top))

test('opening a drawer does not move the card the reader is looking at', async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
  await page.goto('/app?board=b-atlas')
  await expect(page.locator('[data-workflow="cards"]').first()).toBeVisible()

  await page.locator('[data-board-scroll]').evaluate((el) => {
    el.scrollTop = 500
  })
  const anchor = await anchorCard(page)
  expect(anchor, 'a card is in view to hold').toBeTruthy()

  // A card below it, opened in the drawer: the board narrows, every column reflows taller, and the
  // anchor would slide down by the growth above it without the keeper.
  const other = await page.locator('[data-board-scroll]').evaluate((box) => {
    const bounds = box.getBoundingClientRect()
    const cards = [...box.querySelectorAll<HTMLElement>('[data-workflow] [data-card-id]')]
    const second = cards.filter((c) => {
      const rect = c.getBoundingClientRect()
      return rect.top >= bounds.top && rect.top < bounds.bottom - 60
    })[1]
    return second?.dataset.cardId ?? null
  })
  await page.locator(`[data-card-id="${other}"]`).click()
  await expect(page.locator('[data-item-panel]')).toBeVisible()

  await expect.poll(() => cardY(page, anchor!.id)).toBeGreaterThanOrEqual(anchor!.y - 2)
  expect(Math.abs((await cardY(page, anchor!.id)) - anchor!.y)).toBeLessThanOrEqual(2)
})

test('moving a card at the bottom of the board keeps the bottom', async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
  await page.goto('/app?board=b-nova')
  await expect(page.locator('[data-workflow="cards"]').first()).toBeVisible()

  await page.locator('[data-board-scroll]').evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  expect((await scrollState(page)).distance).toBeLessThanOrEqual(2)

  const before = await page.locator('[data-board-scroll]').evaluate((box) => {
    const visible = [...box.querySelectorAll<HTMLElement>('[data-workflow="cards"] [data-card-id]')]
      .map((c) => ({ id: c.dataset.cardId!, y: Math.round(c.getBoundingClientRect().top) }))
      .filter((c) => c.y > 150 && c.y < 860)
    // The page's height is its tallest column. Pick a card from a column that is not setting that
    // height, so moving it out cannot shrink the page and clamp the view: the bottom staying still
    // is then about the board's own anchoring, not about the browser having nowhere to scroll.
    const leaves = [...box.querySelectorAll<HTMLElement>('[data-workflow="cards"] [data-lane-cell]')]
      .filter((cell) => !cell.querySelector('[data-lane-cell]'))
    const content = new Map<HTMLElement, number>(
      leaves.map((cell) => [
        cell,
        [...cell.querySelectorAll<HTMLElement>('[data-card-id]')].reduce(
          (sum, card) => sum + card.getBoundingClientRect().height,
          0,
        ),
      ]),
    )
    const tallest = Math.max(...content.values())
    const candidate = leaves
      .filter((cell) => content.get(cell)! < tallest)
      .flatMap((cell) => {
        const cards = [...cell.querySelectorAll<HTMLElement>('[data-card-id]')]
        const last = cards[cards.length - 1]
        if (!last) return []
        const top = last.getBoundingClientRect().top
        return top > 150 && top < 860 ? [{ id: last.dataset.cardId!, height: content.get(cell)! }] : []
      })
      .sort((a, b) => a.height - b.height)[0]
    return { visible, card: candidate?.id ?? null }
  })
  expect(before.card, 'a short column has a visible card to move').toBeTruthy()
  const beforeHeight = (await scrollState(page)).height

  const card = await page.locator(`[data-card-id="${before.card}"]`).boundingBox()
  const done = await page
    .locator('[data-flow-band]')
    .first()
    .locator('[data-workflow="cards"] [data-lane-cell]')
    .filter({ hasText: 'Done' })
    .last()
    .boundingBox()
  expect(card && done).toBeTruthy()

  await page.mouse.move(card!.x + card!.width / 2, card!.y + 18)
  await page.mouse.down()
  await page.mouse.move(done!.x + done!.width / 2, done!.y + 60, { steps: 15 })
  await page.mouse.up()

  // Still at the end of the board, and the cards the reader was looking at have not slid. The
  // source was a short column, so the tallest column — the page height — did not change; the
  // destination column is excluded because it gained a card and its own cards move down, which is
  // the arrangement the reader asked for.
  await expect.poll(async () => (await scrollState(page)).distance).toBeLessThanOrEqual(2)
  expect((await scrollState(page)).height, 'the move did not change the board height').toBe(beforeHeight)
  const landed = await page
    .locator('[data-flow-band]')
    .first()
    .locator('[data-workflow="cards"] [data-lane-cell]')
    .filter({ hasText: 'Done' })
    .last()
    .locator('[data-card-id]')
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.cardId))
  const untouched = before.visible.filter((c) => c.id !== before.card && !landed.includes(c.id))
  expect(untouched.length, 'cards outside the destination were in view').toBeGreaterThan(2)
  for (const previous of untouched.slice(0, 4)) {
    const moved = Math.abs((await cardY(page, previous.id)) - previous.y)
    expect(moved, `${previous.id} moved`).toBeLessThanOrEqual(2)
  }
})
