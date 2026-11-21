import { expect, test } from '@playwright/test'
import { dragCardTo, lane } from './support'

/**
 * The small cross-engine reading.
 *
 * The full suite runs on Chromium. These two checks run on Firefox, WebKit and mobile Safari as
 * well: the board draws, a card opens with its warnings, and a pointer moves a card between
 * columns. They are deliberately a smoke, not a second copy of every desktop test — the engines
 * differ in JavaScript, layout and pointer handling, and this is where that difference shows up
 * first.
 */

test('a board draws, and a card opens with its warnings', async ({ page }) => {
  await page.goto('/app?board=b-atlas')
  await expect(page.getByRole('heading', { name: 'Team Atlas', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Initiatives workflow' })).toBeVisible()

  const card = page.locator('[data-card-id="st-enterprise-sso"]').first()
  await expect(card).toBeVisible()
  await card.click()

  const panel = page.locator('[data-item-panel]')
  await expect(panel).toBeVisible()
  await expect(panel.getByLabel('Title')).toHaveValue('Add SSO for enterprise tenants')
  await expect(panel.locator('[data-card-warnings]')).toContainText('Waiting on the identity contract')

  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
})

test('a card moves between columns on a desktop engine', async ({ page, isMobile }) => {
  // A drag is a pointer gesture; the mobile profile has touch and a much narrower board. The
  // columns still render there, and the first check proves it.
  test.skip(isMobile, 'the pointer drag is covered on the desktop engines')

  await page.goto('/app?board=b-atlas')
  const card = page.locator('[data-card-id="st-enterprise-sso"]').first()
  await expect(card).toBeVisible()

  // Bring the cards row into the viewport before aiming: the initiatives band and the drawer's
  // surrounding layout make the row's vertical position engine-dependent.
  const backlogLane = lane(page, 'Backlog')
  await backlogLane.scrollIntoViewIfNeeded()
  await card.scrollIntoViewIfNeeded()
  const backlog = await backlogLane.boundingBox()
  if (!backlog) throw new Error('The Backlog lane has no box to drop into.')

  await dragCardTo(page, 'st-enterprise-sso', {
    x: backlog.x + 20,
    y: backlog.y + 40,
  })
  await expect(lane(page, 'Backlog').locator('[data-card-id="st-enterprise-sso"]')).toBeVisible()
})
