import { expect, test } from '@playwright/test'
import { openBoard } from './support'

/**
 * Boundary work is a workflow below the cards (task 174).
 *
 * The demo board has real boundary dependencies — Team Atlas waits on Team Nova's identity platform
 * and a few others — so this is the seeded truth rather than a fixture invented for the test.
 */

test('boundary work is a workflow below the cards, in the four typed stages', async ({ page }) => {
  await openBoard(page)

  const workflow = page.locator('[data-workflow="boundary"]')
  await expect(workflow).toBeVisible()
  // Below the cards workflow, not beside it: the rail is gone.
  const afterCards = await workflow.evaluate((element) => {
    const cards = document.querySelector('[data-workflow="cards"]')
    return Boolean(cards && cards.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
  })
  expect(afterCards).toBe(true)

  for (const stage of ['backlog', 'notStarted', 'inProgress', 'done']) {
    await expect(page.locator(`[data-boundary-stage="${stage}"]`)).toBeVisible()
  }

  // It is a lens: nothing in it is a card on this board, so nothing leaks into a count or a drag.
  await expect(workflow.locator('[data-card-id]')).toHaveCount(0)
  // …and the old sticky rail is gone.
  await expect(page.locator('[aria-label="Boundary — waiting on"]')).toHaveCount(0)
})

test('both ends name each other, and either one enters the focus state', async ({ page }) => {
  await openBoard(page)

  const identity = page.locator('[data-boundary-card="init-identity"]')
  await expect(identity).toBeVisible()
  // The boundary card names the card on this board that waits on it.
  const dependentLink = identity.getByRole('button', { name: 'Add SSO for enterprise tenants' })
  await expect(dependentLink).toBeVisible()

  // …and that card wears the chips, without anything being selected first. It waits on two
  // external things, and each is named — a count would have hidden one of them.
  const sso = page.locator('[data-card-id="st-enterprise-sso"]')
  await expect(sso.locator('[data-waiting-on] button')).toHaveCount(2)

  // The card itself is the control: pressing its face selects it, with no separate button to find.
  const title = identity.getByRole('button', { name: 'Identity platform', exact: true })
  await identity.getByText('Open · live blockage').click()
  await expect(title).toHaveAttribute('aria-pressed', 'true')
  await expect(identity).toContainText('linked')
  // Unrelated cards recede while the relationship is the thing being read.
  await expect(page.locator('[data-card-id="st-usage-billing"]')).toHaveClass(/opacity-40/)

  // The same face clears it: one control, two states.
  await identity.getByText('Open · live blockage').click()
  await expect(title).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('[data-card-id="st-usage-billing"]')).not.toHaveClass(/opacity-40/)

  // Keyboard: the name is a button, so Enter does what the click did.
  await title.focus()
  await page.keyboard.press('Enter')
  await expect(title).toHaveAttribute('aria-pressed', 'true')
  await expect(identity).toContainText('linked')

  // From the other end, the chip selects the same card and takes the reader to it.
  await identity.getByText('Open · live blockage').click()
  await expect(title).toHaveAttribute('aria-pressed', 'false')
  await sso.getByRole('button', { name: 'Waiting on Identity platform' }).click()
  await expect(title).toHaveAttribute('aria-pressed', 'true')
})

test('a coordination board has no boundary workflow', async ({ page }) => {
  // The programme board renders bands, not a cards workflow: there is no edge of *this* board to show.
  await page.goto('/app?board=b-delivery')
  await expect(page.locator('[data-workflow="initiatives"]').first()).toBeVisible()
  await expect(page.locator('[data-workflow="boundary"]')).toHaveCount(0)
})
