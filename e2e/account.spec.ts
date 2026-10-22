import { expect, test } from '@playwright/test'

/**
 * The account control, against the self-hosted entry.
 *
 * The dev switch stands in for a provider on purpose: it is the one identity that needs no outside
 * service, and the flow after it — session cookie, reload, sign-out — is the same flow a real
 * provider's callback ends in.
 */
const SELF_HOSTED = 'http://localhost:4174'

test('a person signs in, stays signed in across a reload, and signs out', async ({ page }) => {
  await page.goto(SELF_HOSTED)

  const signIn = page.getByRole('button', { name: 'Sign in' })
  await expect(signIn).toBeVisible()

  await signIn.click()
  await page.getByPlaceholder('you@example.com').fill('maya.blake@example.com')
  await page.getByRole('button', { name: 'Sign in as this address' }).click()

  // The account becomes the workspace's own person of that name, so "my work" and the author on a
  // change are right while the workspace is still local.
  const account = page.getByRole('button', { name: /Maya Blake/ })
  await expect(account).toBeVisible()

  await page.reload()
  await expect(page.getByRole('button', { name: /Maya Blake/ })).toBeVisible()

  await page.getByRole('button', { name: /Maya Blake/ }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
})
