/**
 * Who is asking, and what they may do.
 *
 * One module resolves authority for the API, and it asks the database on every request — the door
 * (`instance_members`) and the role (`workspace_members`). Nothing is cached in the session and
 * nothing is cached in the process: a removal or a demotion has to be visible on the next request,
 * because that is the only moment a person could notice it.
 *
 * The action names are the ones in `src/domain/roles.ts`. There is no second table here; this file
 * only knows how to find out *which role* to ask about.
 *
 * The statuses say different things on purpose: 401 means "I do not know you", 403 means "I know you
 * and you may not", and 404 means "there is nothing here for you" — used for a workspace somebody is
 * not a member of, because naming it would confirm it exists.
 */

import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { can } from '../src/domain/roles'
import type { Action, Role } from '../src/domain/roles'
import { sessionCookie, sessionCookieName, userForToken, WORKSPACE_ID } from './auth/session'
import type { AuthUser } from './auth/session'
import type { Database } from './db'
import { effectiveRole } from './groups'
import { schemaVersion } from './migrate'
import type { Runtime } from './runtime'
import { REQUIRED_SCHEMA } from './workspace/schema'

export interface Caller {
  db: Database
  user: AuthUser
  instanceRole: 'admin' | 'member'
}

export interface WorkspaceCaller extends Caller {
  /** The workspace this request is about — resolved here, never taken on trust from the browser. */
  workspaceId: string
  workspaceRole: Role
  /**
   * Where that role came from: `direct`, or `group:<name>`. The screen says so, because a role
   * nobody can explain is a role nobody can change.
   */
  roleSource: string
}

type Hono = Context<{ Bindings: object }>

/**
 * Which workspace a request is about.
 *
 * A path parameter when a route names one, and the instance's only workspace otherwise. The body is
 * deliberately not consulted: reading it here would consume the stream the route needs, and nothing
 * the client sends can be allowed to choose the scope anyway.
 */
export function workspaceId(c: Hono): string {
  return c.req.param('workspaceId') ?? WORKSPACE_ID
}

function fail(c: Hono, body: Record<string, unknown>, status: 401 | 403 | 404 | 503): Response {
  return c.json(body, status) as unknown as Response
}

/**
 * The session, and the door.
 *
 * A database that has not been migrated is refused for anything that would write — the same rule the
 * workspace routes had, kept here because every route goes through this door.
 */
export async function requireUser(c: Hono, runtime: Runtime): Promise<Caller | Response> {
  const db = runtime.database(c.env)
  if (!db) return fail(c, { error: 'not configured' }, 503)

  const token = getCookie(c, sessionCookie(c.env, c.req.raw).name)
  if (!token) return fail(c, { error: 'sign in to use this workspace' }, 401)

  const user = await userForToken(db, token)
  if (!user) return fail(c, { error: 'sign in to use this workspace' }, 401)

  const instance = await db.get<{ role: string }>('SELECT role FROM instance_members WHERE user_id = ?1', [user.id])
  if (!instance) return fail(c, { error: 'not a member of this instance' }, 403)

  if (c.req.method !== 'GET' && (await schemaVersion(db)) < REQUIRED_SCHEMA) {
    return fail(c, { error: 'this instance has not finished migrating' }, 503)
  }

  return { db, user, instanceRole: instance.role === 'admin' ? 'admin' : 'member' }
}

/**
 * The same door, for a connection that is not a request.
 *
 * A WebSocket upgrade carries a cookie and a URL, not a `Context`: the session is read from the
 * header and checked the way `requireWorkspace` checks it — the door, the workspace, and the action.
 * Everything that decides is shared with the HTTP path; only the way the cookie is found differs.
 */
export async function workspaceCallerFromCookie(
  db: Database,
  env: unknown,
  cookieHeader: string | undefined,
  url: string,
  action: Action,
): Promise<WorkspaceCaller | undefined> {
  const name = sessionCookieName(env, url)
  const token = (cookieHeader ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1)
  if (!token) return undefined

  const user = await userForToken(db, token)
  if (!user) return undefined

  const instance = await db.get<{ role: string }>('SELECT role FROM instance_members WHERE user_id = ?1', [user.id])
  if (!instance) return undefined

  const grant = await effectiveRole(db, user.id, WORKSPACE_ID)
  const resolved: { role: Role; source: string } | undefined =
    grant ?? (instance.role === 'admin' ? { role: 'admin', source: 'instance' } : undefined)
  if (!resolved || !can(resolved.role, action)) return undefined

  return {
    db,
    user,
    instanceRole: instance.role === 'admin' ? 'admin' : 'member',
    workspaceId: WORKSPACE_ID,
    workspaceRole: resolved.role,
    roleSource: resolved.source,
  }
}

/** The instance's own administration: the people, the invitations, the access policy. */
export async function requireInstanceAdmin(c: Hono, runtime: Runtime): Promise<Caller | Response> {
  const caller = await requireUser(c, runtime)
  if (caller instanceof Response) return caller
  if (caller.instanceRole !== 'admin') return fail(c, { error: 'administrators only' }, 403)
  return caller
}

/**
 * The workspace, and the action in it.
 *
 * A person who is not a member sees 404: there is nothing here for them, and saying "403" would
 * confirm that this instance holds a workspace they cannot see. An instance administrator is the
 * exception — repairing a team you are not on is the reason the two axes are separate.
 */
export async function requireWorkspace(
  c: Hono,
  runtime: Runtime,
  action: Action,
): Promise<WorkspaceCaller | Response> {
  const caller = await requireUser(c, runtime)
  if (caller instanceof Response) return caller

  const id = workspaceId(c)
  // The union of the direct row and every active group's grant, highest wins — see `effectiveRole`.
  const grant = await effectiveRole(caller.db, caller.user.id, id)

  // An instance administrator may repair a workspace they are not on; that is the reason the two
  // axes are separate.
  const resolved: { role: Role; source: string } | undefined =
    grant ?? (caller.instanceRole === 'admin' ? { role: 'admin', source: 'instance' } : undefined)
  if (!resolved) return fail(c, { error: 'no such workspace' }, 404)

  if (!can(resolved.role, action)) return fail(c, { error: `a ${resolved.role} may not ${action}` }, 403)

  return { ...caller, workspaceId: id, workspaceRole: resolved.role, roleSource: resolved.source }
}
