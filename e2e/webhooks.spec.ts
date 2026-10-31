import { createServer } from 'node:http'
import { expect, test } from '@playwright/test'
import { addCardTo, openInstanceBoard } from './support'

/**
 * A webhook from the administrator's screen, to a receiver in this test process.
 *
 * The point is the whole path: add a card, the event is recorded, the delivery is sent with its
 * signature and the receiver can verify it. The endpoint is a real HTTP listener on loopback, not a
 * stub in the browser, so the instance's own dispatcher is what makes the request.
 */
const ORIGIN = 'http://localhost:4181'
const BOARD = 'Webhook Atlas'

test.describe.configure({ mode: 'serial' })

test('an administrator creates an endpoint, and a card event is delivered and signed', async ({ page }) => {
  const received: Array<{ headers: Record<string, string | string[] | undefined>; body: string }> = []
  const receiver = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += String(chunk)
    })
    request.on('end', () => {
      received.push({ headers: request.headers, body })
      response.writeHead(204)
      response.end()
    })
  })
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve))
  const port = (receiver.address() as { port: number }).port

  try {
    await openInstanceBoard(page, ORIGIN, BOARD, { email: 'hook-admin@example.com', name: 'Hook Admin' })

    // The endpoint is made in Admin, before the work happens.
    await page.goto(`${ORIGIN}/app?view=boards`)
    await page.getByRole('button', { name: /^Admin/ }).click()
    await page.getByRole('tab', { name: 'Webhooks' }).click()
    const panel = page.locator('[data-webhooks-panel]')
    await panel.getByLabel('Endpoint URL').fill(`http://127.0.0.1:${port}/events`)
    await panel.getByRole('button', { name: 'Add endpoint' }).click()
    await expect(panel.locator('[data-webhook-secret]')).toBeVisible()

    // A card is made on the board, which is an item.created event.
    await page.goto(`${ORIGIN}/app?view=boards`)
    await page.getByRole('button', { name: BOARD, exact: true }).click()
    await addCardTo(page, 'Backlog')

    // Send what is due now rather than waiting for the process's own timer.
    await page.goto(`${ORIGIN}/app?view=boards`)
    await page.getByRole('button', { name: /^Admin/ }).click()
    await page.getByRole('tab', { name: 'Webhooks' }).click()
    await page.locator('[data-webhooks-panel]').getByRole('button', { name: /Send due now/ }).click()

    await expect.poll(() => received.length, { timeout: 15_000 }).toBeGreaterThan(0)
    const delivery = received.find((entry) => entry.headers['x-kanban-event'] === 'item.created')
    expect(delivery).toBeTruthy()
    expect(delivery!.headers['x-kanban-signature']).toMatch(/^v1=[0-9a-f]{64}$/)
    expect(delivery!.headers['x-kanban-timestamp']).toMatch(/^\d+$/)
    const envelope = JSON.parse(delivery!.body) as { type: string; data: { itemId: string; title: string } }
    expect(envelope.type).toBe('item.created')
    expect(envelope.data.title).toContain('New card')

    // The delivery log is a reading of the same fact, with the receiver's answer.
    await expect(page.locator('[data-webhook-deliveries]')).toContainText('item.created')
    await expect(page.locator('[data-webhook-deliveries]')).toContainText('delivered')
    await expect(page.locator('[data-webhook-deliveries]')).toContainText('HTTP 204')
  } finally {
    await new Promise<void>((resolve) => receiver.close(() => resolve()))
  }
})

test('an instance administrator takes a database copy from Admin', async ({ page }) => {
  await openInstanceBoard(page, ORIGIN, BOARD, { email: 'hook-admin@example.com', name: 'Hook Admin' })
  await page.goto(`${ORIGIN}/app?view=boards`)
  await page.getByRole('button', { name: /^Admin/ }).click()
  await page.getByRole('tab', { name: 'Backups' }).click()
  const panel = page.locator('[data-backups-panel]')
  await expect(panel).toContainText('files on this machine')
  await panel.getByRole('button', { name: 'Take a copy' }).click()
  await expect(panel).toContainText(/Copy taken: kanbantoolkit-/)
  await expect(panel.getByRole('link', { name: /Download/ }).first()).toBeVisible()
})
