/**
 * Delivering outbound events, and retrying what did not land.
 *
 * A delivery is at-least-once: a 2xx is success, everything else is a try that will come again.
 * The signature is HMAC-SHA256 over `${timestamp}.${body}` with the endpoint's secret, and the
 * receiver verifies the same bytes. A 410 is the receiver saying "stop", so the endpoint is
 * disabled rather than retried forever.
 *
 * The dispatcher is called by a timer on a self-hosted instance and by a scheduled Worker. It is
 * deliberately not called inline with a write: a receiver's latency is not the board's latency.
 */

import type { Database } from './db'
import type { EventEnvelope } from './events'

const MAX_ATTEMPTS = 5
const TIMEOUT_MS = 10_000
/** After the first failure: one minute, then five, thirty, two hours, six. */
export const BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000] as const

export interface DeliveryJob {
  deliveryId: string
  endpointId: string
  attempts: number
  payload: string
  url: string
  secret: string
  eventType: string
  workspaceId: string
}

export interface DispatchResult {
  delivered: number
  failed: number
  retried: number
}

/** A secret is 32 random bytes, hex — long enough that guessing it is not a plan. */
export function newSecret(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** The value in `X-Kanban-Signature`, for a receiver to compare in constant time. */
export async function sign(secret: string, timestamp: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`))
  return `v1=${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

const header = (eventType: string, eventId: string, timestamp: number, signature: string) => ({
  'content-type': 'application/json',
  'user-agent': 'KanbanToolkit-Webhooks/1',
  'x-kanban-event': eventType,
  'x-kanban-delivery': eventId,
  'x-kanban-timestamp': String(timestamp),
  'x-kanban-signature': signature,
})

async function dueJobs(db: Database, now: number, limit: number): Promise<DeliveryJob[]> {
  const rows = await db.all<{
    delivery_id: string
    endpoint_id: string
    attempts: number
    payload: string
    url: string
    secret: string
    type: string
    workspace_id: string
  }>(
    `SELECT d.id AS delivery_id, d.endpoint_id, d.attempts, e.payload, w.url, w.secret, e.type, w.workspace_id
       FROM webhook_deliveries d
       JOIN webhook_endpoints w ON w.id = d.endpoint_id
       JOIN outbound_events e ON e.id = d.event_id
      WHERE d.status = 'pending' AND d.next_attempt_at <= ?1 AND w.active = 1
      ORDER BY d.next_attempt_at, d.id
      LIMIT ?2`,
    [now, limit],
  )
  return rows.map((row) => ({
    deliveryId: row.delivery_id,
    endpointId: row.endpoint_id,
    attempts: row.attempts,
    payload: row.payload,
    url: row.url,
    secret: row.secret,
    eventType: row.type,
    workspaceId: row.workspace_id,
  }))
}

/**
 * Send every delivery that is due.
 *
 * A delivery is claimed by a status change before the request, so two dispatchers cannot both send
 * the same row; if this process dies mid-request the row stays `delivering`, which is visible in the
 * delivery log rather than silently lost. The next successful attempt resets it.
 */
export async function dispatchDue(
  db: Database,
  options: { now?: number; limit?: number; fetchImpl?: typeof fetch } = {},
): Promise<DispatchResult> {
  const now = options.now ?? Date.now()
  const jobs = await dueJobs(db, now, Math.max(1, Math.min(options.limit ?? 25, 100)))
  const request = options.fetchImpl ?? fetch
  const result: DispatchResult = { delivered: 0, failed: 0, retried: 0 }

  for (const job of jobs) {
    const claimed = await db.run(
      "UPDATE webhook_deliveries SET status = 'delivering', updated_at = ?1 WHERE id = ?2 AND status = 'pending'",
      [now, job.deliveryId],
    )
    if (claimed.changes === 0) continue

    const timestamp = now
    try {
      const signature = await sign(job.secret, timestamp, job.payload)
      const response = await request(job.url, {
        method: 'POST',
        headers: header(job.eventType, job.deliveryId, timestamp, signature),
        body: job.payload,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      const attempts = job.attempts + 1
      if (response.ok) {
        await db.run(
          "UPDATE webhook_deliveries SET status = 'delivered', attempts = ?1, response_status = ?2, error = NULL, updated_at = ?3 WHERE id = ?4",
          [attempts, response.status, now, job.deliveryId],
        )
        result.delivered++
        continue
      }

      // The receiver is saying the endpoint itself is gone. A retry would only be noise.
      if (response.status === 410) {
        await db.batch([
          {
            sql: "UPDATE webhook_endpoints SET active = 0, disabled_reason = 'endpoint answered 410 Gone' WHERE id = ?1",
            params: [job.endpointId],
          },
          {
            sql: "UPDATE webhook_deliveries SET status = 'failed', attempts = ?1, response_status = 410, error = 'endpoint answered 410 Gone', updated_at = ?2 WHERE id = ?3",
            params: [attempts, now, job.deliveryId],
          },
        ])
        result.failed++
        continue
      }

      const exhausted = attempts >= MAX_ATTEMPTS
      const next = now + (BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)] ?? BACKOFF_MS[0])
      await db.run(
        `UPDATE webhook_deliveries
            SET status = ?1, attempts = ?2, response_status = ?3, error = ?4, next_attempt_at = ?5, updated_at = ?6
          WHERE id = ?7`,
        [
          exhausted ? 'failed' : 'pending',
          attempts,
          response.status,
          `HTTP ${response.status}`,
          next,
          now,
          job.deliveryId,
        ],
      )
      if (exhausted) result.failed++
      else result.retried++
    } catch (error) {
      const attempts = job.attempts + 1
      const exhausted = attempts >= MAX_ATTEMPTS
      const next = now + (BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)] ?? BACKOFF_MS[0])
      const message = error instanceof Error ? error.message.slice(0, 500) : 'delivery failed'
      await db.run(
        `UPDATE webhook_deliveries
            SET status = ?1, attempts = ?2, error = ?3, next_attempt_at = ?4, updated_at = ?5
          WHERE id = ?6`,
        [exhausted ? 'failed' : 'pending', attempts, message, next, now, job.deliveryId],
      )
      if (exhausted) result.failed++
      else result.retried++
    }
  }
  return result
}

/**
 * Put one test event in front of one endpoint, regardless of its event filter.
 *
 * The event is written like any other so the receiver can verify the signature with the same code;
 * only the fan-out is narrowed to the endpoint being tested.
 */
export async function queueTestEvent(
  db: Database,
  workspaceId: string,
  endpointId: string,
  actorId?: string,
): Promise<string | undefined> {
  const endpoint = await db.get<{ id: string }>('SELECT id FROM webhook_endpoints WHERE id = ?1 AND workspace_id = ?2', [
    endpointId,
    workspaceId,
  ])
  if (!endpoint) return undefined

  const occurredAt = Date.now()
  const eventId = crypto.randomUUID()
  const deliveryId = crypto.randomUUID()
  const envelope: EventEnvelope = {
    id: eventId,
    type: 'webhook.test',
    occurredAt,
    workspaceId,
    ...(actorId ? { actorId } : {}),
    data: { endpointId },
  }
  await db.batch([
    {
      sql: 'INSERT INTO outbound_events (id, workspace_id, type, payload, occurred_at, actor_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
      params: [eventId, workspaceId, 'webhook.test', JSON.stringify(envelope), occurredAt, actorId ?? null],
    },
    {
      sql: `INSERT INTO webhook_deliveries
              (id, endpoint_id, event_id, status, attempts, next_attempt_at, created_at, updated_at)
            VALUES (?1, ?2, ?3, 'pending', 0, ?4, ?4, ?4)`,
      params: [deliveryId, endpointId, eventId, occurredAt],
    },
  ])
  return deliveryId
}

/** Try a delivery again now, keeping its attempt count so the log tells the truth. */
export async function retryDelivery(db: Database, workspaceId: string, deliveryId: string, now = Date.now()): Promise<boolean> {
  const row = await db.get<{ id: string }>(
    `SELECT d.id FROM webhook_deliveries d
       JOIN webhook_endpoints w ON w.id = d.endpoint_id
      WHERE d.id = ?1 AND w.workspace_id = ?2`,
    [deliveryId, workspaceId],
  )
  if (!row) return false
  await db.run(
    "UPDATE webhook_deliveries SET status = 'pending', next_attempt_at = ?1, error = NULL, updated_at = ?1 WHERE id = ?2",
    [now, deliveryId],
  )
  return true
}
