/**
 * The instance's workspace — one, and made by the installation.
 *
 * A workspace used to be something an account could make for itself: an email owned what it asked
 * for, a form named it, and a sign-up page put that act where a stranger arrived. With **one
 * instance per team** (task 163) that act has no meaning: the workspace is created with the
 * deployment, named by it (`WORKSPACE_NAME`), and the first person to sign in is its administrator.
 * There is no second workspace to switch to and none to make.
 *
 * The route stays, and refuses. A client that still tries — an old tab, a script written against the
 * documented API — is told what this software is rather than handed a 404 that reads like a typo.
 */

import { Hono } from 'hono'
import { requireUser } from './access'
import type { Runtime } from './runtime'

/** The one sentence this route has to say, kept in one place so the tests and the copy agree. */
export const ONE_WORKSPACE =
  'This deployment is one workspace, and its installation already made it. There is no second one to create.'

export function workspaceRoutes(runtime: Runtime) {
  const routes = new Hono<{ Bindings: object }>()

  /**
   * Refused, after the door has established who is asking.
   *
   * Authentication first, so the answer is the same shape as every other route's: 401 for somebody
   * the instance does not know, 409 for the act itself. A refusal that skipped the door would tell
   * a stranger something about the deployment before he had any business knowing it.
   */
  routes.post('/', async (c) => {
    const caller = await requireUser(c, runtime)
    if (caller instanceof Response) return caller
    return c.json({ error: ONE_WORKSPACE }, 409)
  })

  return routes
}
