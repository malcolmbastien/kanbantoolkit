import { expect, test } from '@playwright/test'
import { openBoard } from './support'

/**
 * A mention is a name in a note, not a thread.
 *
 * `@` offers people, choosing one writes the name into the sentence, and the note records who it
 * means. The person is named under the comment in Comments and the same note is listed under Mentions
 * in My work — the two places a mention has to be readable from.
 */
test('a comment mentions a teammate, and the mention comes back in My work', async ({ page }) => {
  await openBoard(page)
  await page.locator('[data-card-id="st-signup-rebuild"]').click()
  const panel = page.locator('[data-item-panel]')
  await expect(panel).toBeVisible()

  await panel.getByRole('button', { name: 'Comments', exact: true }).click()
  const note = panel.getByLabel('Write a comment')
  await note.fill('@Ri')
  const picker = panel.locator('[data-mention-picker]')
  await expect(picker).toBeVisible()
  await picker.getByRole('option', { name: /Riley Kim/ }).click()
  await expect(note).toHaveValue('@Riley Kim ')

  await note.pressSequentially('can you review the copy?')
  await note.press('Enter')
  await expect(panel.locator('[data-mention-chip="u-rk"]')).toContainText('Riley Kim')
  await expect(panel).toContainText('can you review the copy?')
  // Flat by construction: there is no reply or thread control on a note.
  await expect(panel.getByRole('button', { name: /reply/i })).toHaveCount(0)

  // My work is the other end of the mention: it lists the note for the person named.
  await page.keyboard.press('Control+k')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Command palette query').fill('my work')
  await page.keyboard.press('Enter')
  const myWork = page.locator('[data-my-work]')
  await expect(myWork).toBeVisible()
  await myWork.getByLabel('Whose work to show').selectOption('u-rk')
  const mentions = myWork.locator('[data-my-work-mentions]')
  await expect(mentions).toBeVisible()
  await expect(mentions).toContainText('Rebuild the signup form')
  await expect(mentions).toContainText('can you review the copy?')

  // Reading it from My work opens the card again, in the drawer that replaces it.
  await mentions.locator('[data-my-work-mention]').first().click()
  await expect(page.locator('[data-item-panel]')).toHaveAttribute('aria-label', 'Card details: Rebuild the signup form')
})
