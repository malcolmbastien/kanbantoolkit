import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

/**
 * The magic link, in a browser (task 154.7).
 *
 * This runs against the instance on port 4178, which has the console mail transport writing to a file:
 * the door only exists where mail does, and a test that opened a real mailbox would be a test of
 * somebody's relay. Everything else is the real flow — the request, the mail, the link, the session.
 */

const ORIGIN = 'http://localhost:4178'
const LOG = 'node_modules/.tmp/mail.log'
const PASSWORD = 'correct horse battery staple'

test.describe.configure({ mode: 'serial', retries: 0 })

test('a link sent to an address signs that person in, once', async ({ page, request }) => {
  // `request` is a context of its own, so the browser stays signed out — which is the state the link
  // is for. A setup call through `page.request` would have left a session in the cookie jar, and the
  // page would have been signed in before it opened anything.
  const created = await request.post(`${ORIGIN}/api/auth/setup`, {
    data: { name: 'Ada Lovelace', email: 'ada@example.com', password: PASSWORD },
  })
  expect(created.status()).toBe(200)

  // Ask for a link from a browser with no session, which is what the sign-in surface does.
  expect((await request.post(`${ORIGIN}/api/auth/link`, { data: { email: 'ada@example.com' } })).status()).toBe(204)

  // The console transport wrote it to the log. Poll, because the request returning 204 is not the
  // mail having been written yet.
  let link = ''
  await expect
    .poll(
      () => {
        const log = readFileSync(LOG, 'utf8')
        link = log.match(/http:\/\/localhost:4178\/app\?link=[A-Za-z0-9_-]+/)?.[0] ?? ''
        return link
      },
      { timeout: 10_000 },
    )
    .not.toBe('')

  // Opening it signs the person in, without a password being typed.
  await page.goto(link)
  await expect(page.getByRole('button', { name: /Ada Lovelace/ })).toBeVisible()
  const session = await (await page.request.get(`${ORIGIN}/api/auth/session`)).json()
  expect(session.user.email).toBe('ada@example.com')

  // And it is spent: the same link in a browser that has never seen this instance is refused.
  const token = new URL(link).searchParams.get('link')
  const again = await request.post(`${ORIGIN}/api/auth/link/${token}`)
  expect(again.status()).toBe(410)
})

test('an address with no account is told nothing, and sent nothing', async ({ page, request }) => {
  const before = readFileSync(LOG, 'utf8').length
  const answer = await request.post(`${ORIGIN}/api/auth/link`, { data: { email: 'nobody@example.com' } })
  // The same answer a member gets — the point of the flow is that the two are indistinguishable.
  expect(answer.status()).toBe(204)
  await page.waitForTimeout(500)
  expect(readFileSync(LOG, 'utf8').length).toBe(before)
})
