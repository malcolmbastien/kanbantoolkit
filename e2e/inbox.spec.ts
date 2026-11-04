import { expect, test, type Page } from '@playwright/test'
import { cardsIn, dropAtEnd, openBoard } from './support'

/**
 * The bell, from the card to the inbox.
 *
 * A watch is one person's interest in one piece of work, so the test does what a person does: watch
 * the card, read what was already there, then move it and see exactly one new row — one that opens
 * the card where it lives.
 */

async function openFirstBacklogCard(page: Page): Promise<{ id: string; title: string }> {
  const [id] = await cardsIn(page, 'Backlog')
  await page.locator(`[data-card-id="${id}"]`).click()
  const panel = page.locator('[data-item-panel]')
  await expect(panel).toBeVisible()
  const label = (await panel.getAttribute('aria-label')) ?? ''
  return { id, title: label.replace(/^Card details:\s*/, '') }
}

const closeDrawer = (page: Page) => page.getByRole('button', { name: 'Close' }).click()

test('a watched card’s move is one inbox row, and that row opens the card', async ({ page }) => {
  await openBoard(page)
  const { id, title } = await openFirstBacklogCard(page)

  // The drawer's bell is the watch. It is not a write to the card, so it is offered to a Viewer too.
  await page.getByRole('button', { name: 'Watch this item' }).click()
  await expect(page.getByRole('button', { name: 'Watching — stop watching this item' })).toBeVisible()
  await closeDrawer(page)

  // A watch starts now: the card's history is not the news this person asked for.
  await expect(page.locator('[data-inbox-unread]')).toHaveCount(0)

  await dropAtEnd(page, id, 'Done')

  // One move is one row.
  await expect(page.locator('[data-inbox-unread]')).toHaveText('1')
  await page.locator('[data-inbox-trigger]').click()
  const row = page.locator('[data-inbox-row="item.moved"]').first()
  await expect(row).toContainText(`moved ${title}`)
  await expect(row).toContainText('Done')

  // The row is a way into the work, not only a notice about it.
  await row.click()
  await expect(page.locator('[data-item-panel]')).toHaveAttribute('aria-label', `Card details: ${title}`)
})

test('the demo says where its watch list lives', async ({ page }) => {
  await openBoard(page)
  await page.locator('[data-inbox-trigger]').click()
  await expect(page.getByText('On the demo, the watch list and the inbox live in this browser.')).toBeVisible()
})
