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
import { covers, type Scope } from '../src/domain/scopes'
import { sessionCookie, sessionCookieName, userForToken, WORKSPACE_ID } from './auth/session'
import type { AuthUser } from './auth/session'
import type { Database } from './db'
import { effectiveRole } from './groups'
import { schemaVersion } from './migrate'
import type { Runtime } from './runtime'
import { callerForSecret } from './tokens'
import { REQUIRED_SCHEMA } from './workspace/schema'

export interface Caller {
  db: Database
  user: AuthUser
  instanceRole: 'admin' | 'member'
  /**
   * What a bearer credential may reach, when the caller is a token. `undefined` means a session —
   * a person at a browser, holding everything their role grants. A token can only ever narrow that,
   * never widen it: the role is still read from the tables on every request.
   */
  scopes?: Scope[]
  /** Which token this is, for the audit trail and for "revoke the one that is calling". */
  tokenId?: string
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
 * Which workspace a request is about — chosen by the server, and only ever one the caller is in.
 *
 * The rule has three parts, and they are one rule:
 *
 * - a route may **name** a workspace in its path, and that is honoured only when the caller is a
 *   member of it — or, for an instance administrator, when it exists at all;
 * - with no name, it is the caller's own workspace: the first they belong to, so a person in two
 *   starts in the one that sorts first rather than in whichever the browser remembers;
 * - nothing else is consulted. No header, no body, no cookie. A workspace is not a thing a client
 *   can point a read at.
 *
 * `undefined` means "there is nothing here for you", and the caller turns that into a 404 — the
 * same answer for a workspace that does not exist and one somebody may not see.
 */
export async function resolveWorkspace(
  db: Database,
  userId: string,
  instanceAdmin: boolean,
  requested: string | undefined,
): Promise<{ id: string; role: Role; source: string } | undefined> {
  // A direct row, or a group that carries a role here: being in the group is being a member, which
  // is what makes `group_workspace_roles` a way in rather than a decoration on one.
  const memberships = await db.all<{ workspace_id: string }>(
    `SELECT workspace_id FROM workspace_members WHERE user_id = ?1
     UNION
     SELECT r.workspace_id FROM group_members m
       JOIN groups g ON g.id = m.group_id AND g.active = 1
       JOIN group_workspace_roles r ON r.group_id = g.id
      WHERE m.user_id = ?1
     ORDER BY workspace_id`,
    [userId],
  )
  const member = (id: string) => memberships.some((row) => row.workspace_id === id)

  // An administrator may enter a workspace they are not on — the rule that lets somebody repair a
  // team they do not belong to. It still has to exist.
  const asAdmin = async (id: string) =>
    instanceAdmin && (await db.get('SELECT 1 AS seen FROM workspaces WHERE id = ?1', [id]))
      ? { id, role: 'admin' as Role, source: 'instance' }
      : undefined

  if (requested) {
    if (member(requested)) {
      const grant = await effectiveRole(db, userId, requested)
      return grant ? { id: requested, ...grant } : asAdmin(requested)
    }
    return asAdmin(requested)
  }

  const first = memberships[0]?.workspace_id
  if (first) {
    const grant = await effectiveRole(db, userId, first)
    if (grant) return { id: first, ...grant }
  }

  // No membership at all: the instance's own workspace, for its administrator.
  if (!instanceAdmin) return undefined
  // The instance's own workspace: the one a fresh instance creates, and — until a person can
  // choose between two — the only one there is.
  const only =
    (await db.get<{ id: string }>('SELECT id FROM workspaces WHERE id = ?1', [WORKSPACE_ID])) ??
    (await db.get<{ id: string }>('SELECT id FROM workspaces ORDER BY created_at, id LIMIT 1'))
  return only ? { id: only.id, role: 'admin', source: 'instance' } : undefined
}

/**
 * The two questions a permission is, in one place.
 *
 * A route's door asks for the least the request needs; a route whose *change* might need more than
 * its door asked for — the item PATCH that may be a comment or a rewrite — asks again with the
 * action the change actually needs. Both answers are 403, and the sentences differ on purpose: a
 * person reading one learns their role's limit, a script author learns their token's.
 */
export function refusalFor(
  caller: { workspaceRole: Role; scopes?: Scope[] },
  action: Action,
): { error: string } | undefined {
  if (!can(caller.workspaceRole, action)) return { error: `a ${caller.workspaceRole} may not ${action}` }
  if (caller.scopes && !covers(caller.scopes, action)) return { error: `this credential may not ${action}` }
  return undefined
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

  // Two credentials, one door. A session is a person at a browser; a bearer token is a tool that
  // says who it is acting for. A bearer is never a *fallback*: one that does not resolve is a 401,
  // because trying the cookie after it would hide a rotated or revoked secret behind a working
  // browser tab.
  const bearer = bearerOf(c.req.header('authorization'))
  let user: AuthUser | undefined
  let scopes: Scope[] | undefined
  let tokenId: string | undefined

  if (bearer) {
    const found = await callerForSecret(db, bearer)
    if (!found) return fail(c, { error: 'that credential is not valid' }, 401)
    user = found.user
    scopes = found.scopes
    tokenId = found.tokenId
  } else {
    const token = getCookie(c, sessionCookie(c.env, c.req.raw).name)
    if (!token) return fail(c, { error: 'sign in to use this workspace' }, 401)
    user = await userForToken(db, token)
    if (!user) return fail(c, { error: 'sign in to use this workspace' }, 401)
  }

  const instance = await db.get<{ role: string }>('SELECT role FROM instance_members WHERE user_id = ?1', [user.id])
  if (!instance) return fail(c, { error: 'not a member of this instance' }, 403)

  if (c.req.method !== 'GET' && (await schemaVersion(db)) < REQUIRED_SCHEMA) {
    return fail(c, { error: 'this instance has not finished migrating' }, 503)
  }

  return {
    db,
    user,
    instanceRole: instance.role === 'admin' ? 'admin' : 'member',
    ...(scopes ? { scopes, tokenId } : {}),
  }
}

/** The secret in `Authorization: Bearer …`, or nothing. Only the scheme this server issues. */
function bearerOf(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '')
  return match?.[1]
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

  const resolved = await resolveWorkspace(db, user.id, instance.role === 'admin', undefined)
  if (!resolved || !can(resolved.role, action)) return undefined

  return {
    db,
    user,
    instanceRole: instance.role === 'admin' ? 'admin' : 'member',
    workspaceId: resolved.id,
    workspaceRole: resolved.role,
    roleSource: resolved.source,
  }
}

/**
 * The instance's own administration: the people, the invitations, the policy, the groups.
 *
 * Not the account's: an account is a person, and what they own is a workspace — whose owner, bill and
 * end are settled by its own administrator (task 126, revised). Whoever runs the deployment runs the
 * door, and nothing else here.
 */
export async function requireInstanceAdmin(c: Hono, runtime: Runtime): Promise<Caller | Response> {
  const caller = await requireUser(c, runtime)
  if (caller instanceof Response) return caller
  if (caller.instanceRole !== 'admin') return fail(c, { error: 'administrators only' }, 403)
  // The instance's own administration is not a workspace scope, and a token reaches it only when it
  // was minted for it — by an administrator, for an administrator.
  if (caller.scopes && !caller.scopes.includes('instance:admin')) {
    return fail(c, { error: 'this credential may not administer the instance' }, 403)
  }
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

  // The workspace comes from the session's memberships, never from the request body — a route may
  // name one in its path, and that name is checked rather than trusted.
  const resolved = await resolveWorkspace(
    caller.db,
    caller.user.id,
    caller.instanceRole === 'admin',
    c.req.param('workspaceId'),
  )
  // Not a member, or not a workspace: the same 404, because naming the difference would confirm
  // that this instance holds a workspace somebody cannot see.
  if (!resolved) return fail(c, { error: 'no such workspace' }, 404)

  // The role is the ceiling; the scope, when there is one, is what a tool was minted for.
  const refused = refusalFor({ workspaceRole: resolved.role, scopes: caller.scopes }, action)
  if (refused) return fail(c, refused, 403)

  return { ...caller, workspaceId: resolved.id, workspaceRole: resolved.role, roleSource: resolved.source }
}
