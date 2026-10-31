/**
 * The admin door for outbound webhooks.
 *
 * A workspace administrator owns the endpoints: what they listen to, whether they are on, and the
 * delivery log that says what happened. The secret is returned once when the endpoint is made and
 * never again — a screen that can re-read a signing key is a screen that can leak it by accident.
 *
 * The route does not dispatch inline. A test is queued like any other event, and "send now" is an
 * explicit act so a slow receiver cannot make the settings screen hang.
 */

import { Hono } from 'hono'
import { record } from './audit'
import { requireWorkspace } from './access'
import { schemaVersion } from './migrate'
import { REQUIRED_SCHEMA } from './workspace/schema'
import type { Runtime } from './runtime'
import { dispatchDue, newSecret, queueTestEvent, retryDelivery } from './webhooks'
import { WEBHOOK_EVENT_TYPES, type WebhookDeliveryView, type WebhookEndpointView, type WebhookEventType } from '../src/domain/webhooks'

interface EndpointRow {
  id: string
  url: string
  event_types: string
  active: number
  created_at: number
  disabled_reason: string | null
}

const parseTypes = (value: string | null): WebhookEventType[] => {
  try {
    const list = JSON.parse(value ?? '[]') as unknown
    return Array.isArray(list) ? list.filter((entry): entry is WebhookEventType => typeof entry === 'string' && (WEBHOOK_EVENT_TYPES as readonly string[]).includes(entry)) : []
  } catch {
    return []
  }
}

const view = (row: EndpointRow, secret?: string): WebhookEndpointView => ({
  id: row.id,
  url: row.url,
  eventTypes: parseTypes(row.event_types),
  active: row.active === 1,
  createdAt: row.created_at,
  ...(row.disabled_reason ? { disabledReason: row.disabled_reason } : {}),
  ...(secret ? { secret } : {}),
})

const validTypes = (value: unknown): WebhookEventType[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const seen = new Set<WebhookEventType>()
  for (const entry of value) {
    if (typeof entry !== 'string' || !(WEBHOOK_EVENT_TYPES as readonly string[]).includes(entry)) return undefined
    seen.add(entry as WebhookEventType)
  }
  return [...seen]
}

const validUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const url = value.trim()
  if (url.length < 8 || url.length > 2_048) return undefined
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
}

export function webhookRoutes(runtime: Runtime) {
  const routes = new Hono<{ Bindings: object }>()

  /** The administrator's door, and the schema behind it. */
  const callerOf = async (c: Parameters<typeof requireWorkspace>[0]) => {
    const caller = await requireWorkspace(c, runtime, 'workspace.settings')
    if (caller instanceof Response) return caller
    if ((await schemaVersion(caller.db)) < REQUIRED_SCHEMA) {
      return c.json({ error: 'this instance has not finished migrating' }, 503)
    }
    return caller
  }

  routes.get('/webhooks', async (c) => {
    const caller = await callerOf(c)
    if (caller instanceof Response) return caller
    const rows = await caller.db.all<EndpointRow>(
      'SELECT * FROM webhook_endpoints WHERE workspace_id = ?1 ORDER BY created_at, id',
      [caller.workspaceId],
    )
    return c.json({ endpoints: rows.map((row) => view(row)) })
  })

  routes.post('/webhooks', async (c) => {
    const caller = await callerOf(c)
    if (caller instanceof Response) return caller
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
    const url = validUrl(body?.url)
    if (!url) return c.json({ error: 'a webhook URL must be an http or https address' }, 400)
    const eventTypes = body?.eventTypes === undefined ? [] : validTypes(body.eventTypes)
    if (!eventTypes) return c.json({ error: 'eventTypes must name events this instance emits' }, 400)

    const id = crypto.randomUUID()
    const secret = newSecret()
    const createdAt = Date.now()
    await caller.db.run(
      `INSERT INTO webhook_endpoints (id, workspace_id, url, secret, event_types, active, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)`,
      [id, caller.workspaceId, url, secret, JSON.stringify(eventTypes), createdAt],
    )
    await record(caller.db, {
      actorId: caller.user.id,
      action: 'webhook.create',
      targetType: 'webhook',
      targetId: id,
      data: { url, eventTypes },
    })
    return c.json(view({ id, url, event_types: JSON.stringify(eventTypes), active: 1, created_at: createdAt, disabled_reason: null }, secret), 201)
  })

  routes.patch('/webhooks/:id', async (c) => {
    const caller = await callerOf(c)
    if (caller instanceof Response) return caller
    const current = await caller.db.get<EndpointRow>(
      'SELECT * FROM webhook_endpoints WHERE id = ?1 AND workspace_id = ?2',
      [c.req.param('id'), caller.workspaceId],
    )
    if (!current) return c.json({ error: 'no such webhook' }, 404)

    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return c.json({ error: 'a JSON body is required' }, 400)
    const url = body.url === undefined ? current.url : validUrl(body.url)
    if (!url) return c.json({ error: 'a webhook URL must be an http or https address' }, 400)
    const eventTypes = body.eventTypes === undefined ? parseTypes(current.event_types) : validTypes(body.eventTypes)
    if (!eventTypes) return c.json({ error: 'eventTypes must name events this instance emits' }, 400)
    if (body.active !== undefined && typeof body.active !== 'boolean') {
      return c.json({ error: 'active must be true or false' }, 400)
    }
    const active = body.active === undefined ? current.active === 1 : body.active
    const disabledReason = active ? null : (current.disabled_reason ?? 'disabled by an administrator')

    await caller.db.batch([
      {
        sql: 'UPDATE webhook_endpoints SET url = ?1, event_types = ?2, active = ?3, disabled_reason = ?4 WHERE id = ?5',
        params: [url, JSON.stringify(eventTypes), active ? 1 : 0, disabledReason, current.id],
      },
      ...(active
        ? []
        : [
            {
              sql: `UPDATE webhook_deliveries SET status = 'failed', error = 'endpoint disabled', updated_at = ?1
                     WHERE endpoint_id = ?2 AND status = 'pending'`,
              params: [Date.now(), current.id],
            },
          ]),
    ])
    await record(caller.db, {
      actorId: caller.user.id,
      action: 'webhook.update',
      targetType: 'webhook',
      targetId: current.id,
      data: { url, eventTypes, active },
    })
    return c.json(
      view(
        { ...current, url, event_types: JSON.stringify(eventTypes), active: active ? 1 : 0, disabled_reason: disabledReason },
      ),
    )
  })

  routes.delete('/webhooks/:id', async (c) => {
    const caller = await callerOf(c)
    if (caller instanceof Response) return caller
    const current = await caller.db.get<EndpointRow>(
      'SELECT * FROM webhook_endpoints WHERE id = ?1 AND workspace_id = ?2',
      [c.req.param('id'), caller.workspaceId],
    )
    if (!current) return c.json({ error: 'no such webhook' }, 404)
    await caller.db.run('DELETE FROM webhook_endpoints WHERE id = ?1 AND workspace_id = ?2', [current.id, caller.workspaceId])
    await record(caller.db, {
      actorId: caller.user.id,
      action: 'webhook.delete',
      targetType: 'webhook',
      targetId: current.id,
      data: { url: current.url },
    })
    return c.body(null, 204)
  })

  routes.get('/webhooks/:id/deliveries', async (c) => {
    const caller = await callerOf(c)
    if (caller instanceof Response) return caller
    const endpoint = await caller.db.get<{ id: string }>(
      'SELECT id FROM webhook_endpoints WHERE id = ?1 AND workspace_id = ?2',
      [c.req.param('id'), caller.workspaceId],
    )
    if (!endpoint) return c.json({ error: 'no such webhook' }, 404)
    const rows = await caller.db.all<{
      id: string
      event_id: string
      type: string
      status: WebhookDeliveryView['status']
      attempts: number
      next_attempt_at: number
      response_status: number | null
      error: string | null
      created_at: number
      updated_at: number
    }>(
      `SELECT d.id, d.event_id, e.type, d.status, d.attempts, d.next_attempt_at, d.response_status, d.error,
              d.created_at, d.updated_at
         FROM webhook_deliveries d JOIN outbound_events e ON e.id = d.event_id
        WHERE d.endpoint_id = ?1 ORDER BY d.created_at DESC, d.id DESC LIMIT 50`,
      [endpoint.id],
    )
    return c.json({
      deliveries: rows.map(
        (row): WebhookDeliveryView => ({
          id: row.id,
          eventId: row.event_id,
          eventType: row.type as WebhookEventType,
          status: row.status,
          attempts: row.attempts,
          nextAttemptAt: row.next_attempt_at,
          ...(row.response_status === null ? {} : { responseStatus: row.response_status }),
          ...(row.error ? { error: row.error } : {}),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }),
      ),
    })
  })

  routes.post('/webhooks/:id/test', async (c) => {
    const caller = await callerOf(c)
    if (caller instanceof Response) return caller
    const deliveryId = await queueTestEvent(caller.db, caller.workspaceId, c.req.param('id'), caller.user.id)
    if (!deliveryId) return c.json({ error: 'no such webhook' }, 404)
    await record(caller.db, {
      actorId: caller.user.id,
      action: 'webhook.test',
      targetType: 'webhook',
      targetId: c.req.param('id'),
    })
    return c.json({ deliveryId }, 202)
  })

  routes.post('/webhooks/deliveries/:id/retry', async (c) => {
    const caller = await callerOf(c)
    if (caller instanceof Response) return caller
    if (!(await retryDelivery(caller.db, caller.workspaceId, c.req.param('id')))) {
      return c.json({ error: 'no such delivery' }, 404)
    }
    return c.body(null, 204)
  })

  /** Send what is due now. The timer does this on its own; this is the "send now" a person asks for. */
  routes.post('/webhooks/dispatch', async (c) => {
    const caller = await callerOf(c)
    if (caller instanceof Response) return caller
    return c.json(await dispatchDue(caller.db, { limit: 25 }))
  })

  return routes
}
