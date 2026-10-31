/**
 * The instance administrator's copy of the database.
 *
 * The copy is a file, and a file is something a runtime has or does not: a self-hosted Node process
 * can take one with `VACUUM INTO`; a Worker uses the provider's own backup facility. The route asks
 * the runtime (`runtime.backups`) rather than the deployment's name, and a Worker answers with the
 * capability instead of pretending a button worked.
 *
 * A restore is staged, never applied under open connections. The upload is verified against a
 * scratch copy, written beside the live database as `pending-restore.db`, and applied on the next
 * boot when `RESTORE_CONFIRM=yes` is present — the operator's explicit act, not a click's.
 */

import { Hono } from 'hono'
import { requireInstanceAdmin } from './access'
import { record } from './audit'
import { schemaVersion } from './migrate'
import { REQUIRED_SCHEMA } from './workspace/schema'
import type { Runtime } from './runtime'

const NAME = /^kanbantoolkit-[0-9T.-]+\.db$/
const MAX_UPLOAD = 64 * 1024 * 1024

export function backupRoutes(runtime: Runtime) {
  const routes = new Hono<{ Bindings: object }>()

  const callerOf = async (c: Parameters<typeof requireInstanceAdmin>[0]) => {
    const caller = await requireInstanceAdmin(c, runtime)
    if (caller instanceof Response) return caller
    if ((await schemaVersion(caller.db)) < REQUIRED_SCHEMA) {
      return c.json({ error: 'this instance has not finished migrating' }, 503)
    }
    return caller
  }

  routes.get('/backups', async (c) => {
    const caller = await callerOf(c)
    if (caller instanceof Response) return caller
    if (!runtime.backups) return c.json({ mode: 'provider', backups: [] })
    return c.json({ mode: 'file', backups: runtime.backups.list() })
  })

  routes.post('/backups', async (c) => {
    const caller = await callerOf(c)
    if (caller instanceof Response) return caller
    if (!runtime.backups) {
      return c.json({ error: 'this deployment uses the database provider’s own backups', code: 'provider_backup' }, 409)
    }
    try {
      const copy = await runtime.backups.create()
      await record(caller.db, {
        actorId: caller.user.id,
        action: 'backup.create',
        targetType: 'backup',
        targetId: copy.name,
        data: { bytes: copy.bytes },
      })
      return c.json(copy, 201)
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'the copy could not be taken' }, 500)
    }
  })

  routes.get('/backups/:name', async (c) => {
    const caller = await callerOf(c)
    if (caller instanceof Response) return caller
    if (!runtime.backups) return c.json({ error: 'this deployment has no file backups' }, 409)
    const name = c.req.param('name')
    if (!NAME.test(name)) return c.json({ error: 'no such backup' }, 404)
    const file = runtime.backups.read(name)
    if (!file) return c.json({ error: 'no such backup' }, 404)
    await record(caller.db, {
      actorId: caller.user.id,
      action: 'backup.download',
      targetType: 'backup',
      targetId: name,
    })
    return new Response(file as unknown as ArrayBuffer, {
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename="${name}"`,
        'content-length': String(file.byteLength),
      },
    })
  })

  routes.post('/backups/restore', async (c) => {
    const caller = await callerOf(c)
    if (caller instanceof Response) return caller
    if (!runtime.backups) {
      return c.json({ error: 'this deployment uses the database provider’s own restore', code: 'provider_backup' }, 409)
    }
    const body = await c.req.arrayBuffer().catch(() => undefined)
    if (!body || body.byteLength === 0) return c.json({ error: 'a database file is required' }, 400)
    if (body.byteLength > MAX_UPLOAD) return c.json({ error: 'that file is too large' }, 413)
    try {
      const staged = runtime.backups.stageRestore(new Uint8Array(body))
      await record(caller.db, {
        actorId: caller.user.id,
        action: 'backup.restore.stage',
        targetType: 'backup',
        targetId: staged.name,
        data: { boards: staged.boards, items: staged.items },
      })
      return c.json({
        staged: true,
        ...staged,
        restart: 'set RESTORE_CONFIRM=yes and restart the server to apply it',
      })
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'that is not a database this instance can read' }, 422)
    }
  })

  return routes
}
