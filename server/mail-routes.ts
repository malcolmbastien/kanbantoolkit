/**
 * The two links a digest carries.
 *
 * Neither is a session and neither can read a card. A token names a person, a workspace and one act
 * (`mail-token.ts`), so an unsubscribe works from a device that has never signed in and a
 * preferences link can only open the profile — where the person still has to sign in to change
 * anything.
 *
 * The pages are self-contained HTML with no stylesheet, script or remote resource: opening a link
 * in an email must not tell anybody that it was opened, including us.
 */

import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Runtime } from './runtime'
import { requireWorkspace } from './access'
import { mailToken, readMailToken } from './mail-token'

const PAGE = (title: string, body: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root { color-scheme: light }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #fff;
             color: #172b3c; font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
             padding: 2rem; }
      main { max-width: 30rem }
      p { color: #526374 }
      a { color: #086dbf; font-weight: 600 }
    </style>
  </head>
  <body><main>${body}</main></body>
</html>`

export function mailRoutes(runtime: Runtime) {
  const routes = new Hono<{ Bindings: object }>()

  /**
   * Stop the digest.
   *
   * A GET does the act, because the link in an email is what a person clicks. The POST is the
   * RFC 8058 one-click form, for a client that sends the request itself; both read the same token
   * and write the same row.
   */
  const unsubscribe = async (c: Context<{ Bindings: object }>) => {
    const db = runtime.database(c.env)
    if (!db) return c.html(PAGE('Not configured', '<h1>This instance is not configured.</h1>'), 503)

    const token = c.req.query('token') ?? ''
    const claim = await readMailToken(c.env, token).catch(() => undefined)
    if (!claim || claim.action !== 'unsubscribe') {
      return c.html(
        PAGE('That link is not valid', '<h1>That link is not valid.</h1><p>It may have been copied incompletely. Use the link in a recent message, or change your preferences in the app.</p><p><a href="/app">Open the board</a></p>'),
        400,
      )
    }

    const user = await db.get<{ id: string }>('SELECT id FROM users WHERE id = ?1', [claim.userId])
    if (!user) {
      return c.html(
        PAGE('That account is gone', '<h1>That account is gone.</h1><p>There is no one left to unsubscribe.</p>'),
        404,
      )
    }

    await db.run('UPDATE users SET mail_on = 0, updated_at = ?1 WHERE id = ?2', [new Date().toISOString(), claim.userId])
    // Re-enabling starts from now rather than from the last message: a month of old news is not a
    // digest, and the inbox has it for anyone who wants to read back.
    const max = await db.get<{ seq: number | null }>(
      'SELECT MAX(seq) AS seq FROM outbound_events WHERE workspace_id = ?1',
      [claim.workspaceId],
    )
    await db.run(
      `INSERT INTO mail_state (workspace_id, user_id, last_sent_at, last_sent_seq) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET last_sent_at = excluded.last_sent_at,
                                                       last_sent_seq = excluded.last_sent_seq`,
      [claim.workspaceId, claim.userId, Date.now(), max?.seq ?? 0],
    )

    return c.html(
      PAGE(
        'You will not receive email',
        '<h1>You will not receive email.</h1><p>The in-app inbox is still there, and you can turn email back on in your profile.</p><p><a href="/app">Open the board</a></p>',
      ),
    )
  }

  routes.get('/unsubscribe', unsubscribe)
  routes.post('/unsubscribe', unsubscribe)

  /**
   * Open the app at the profile.
   *
   * The token is checked here so a link made for one person is not a link anybody can rewrite, and
   * then the app takes over: the profile still asks who you are before it shows anything.
   */
  routes.get('/preferences', async (c) => {
    const token = c.req.query('token') ?? ''
    const claim = await readMailToken(c.env, token).catch(() => undefined)
    if (!claim || claim.action !== 'preferences') {
      return c.html(
        PAGE('That link is not valid', '<h1>That link is not valid.</h1><p>Use the link in a recent message, or open the app and choose Profile.</p><p><a href="/app">Open the board</a></p>'),
        400,
      )
    }
    return c.redirect('/app?profile=1')
  })

  /**
   * A link for a caller that already has a session, so an admin screen or a test can build one
   * without reading an email. It names the caller, never somebody else.
   */
  routes.get('/token', async (c) => {
    const allowed = await requireWorkspace(c, runtime, 'board.read')
    if (allowed instanceof Response) return allowed
    const action = c.req.query('action') === 'preferences' ? 'preferences' : 'unsubscribe'
    return c.json({ token: await mailToken(c.env, allowed.workspaceId, allowed.user.id, action) })
  })

  return routes
}
