# Kanban Toolkit — admin, identity, and roles

> Design, not code. What Windshift does for sign-in, profiles, user management, active/inactive
> accounts and workspace roles; what Kanban Toolkit already has; and the admin surface a Kanban Toolkit user
> would need before a team can be handed an instance.

**Status:** design only. Task 117 shipped sign-in. Task 118 has not moved the workspace to the
server, so nothing here can be enforced yet — but the **role model** has to be decided before the
first server-side write is stored, because every log entry, invitation and session written without
it has to be migrated afterwards.

**Licence note.** Windshift is AGPL-3.0. This document copies *behaviour and data shape*, not code.
Nothing from its repository should be lifted into Kanban Toolkit; the AGPL would reach the whole app.

**Sources reviewed:** [Users and Groups](https://windshift.sh/docs/06-admin/09-users-and-groups),
[Workspace Roles](https://windshift.sh/docs/06-admin/10-workspace-roles),
[Global Permissions](https://windshift.sh/docs/06-admin/03-global-permissions),
[Security](https://windshift.sh/docs/06-admin/11-security),
[Profile and Security](https://windshift.sh/docs/07-using-windshift/01-profile-and-security),
[Authentication](https://windshift.sh/self-hosting/03-configuration/02-authentication), and the
`internal/models/user.go`, `internal/models/permissions.go`, `internal/routes/users.go` files in
[Windshiftapp/core](https://github.com/Windshiftapp/core).

---

## 1. What Windshift does

Windshift's admin is not a settings page. It is a small access-control system with three axes, and
the separation between them is the part worth copying.

### 1.1 Two kinds of authority, never confused

| | Global permission | Workspace role |
| --- | --- | --- |
| Applies to | The whole instance | One workspace |
| Controls | Creating workspaces, the user directory, public boards, cross-workspace actions | Work inside a workspace: view, create, edit, delete, administer |
| Granted in | Admin → Users & Access → Global Permissions | Workspace member settings |
| Granted by | System administrators | Workspace administrators |

A user needs both for different jobs. `workspace.create` lets someone make a workspace; it does not
let them edit a card in it. `system.admin` is itself a global permission and **bypasses every
check**, global and workspace, and is the only key that opens the Admin panel.

That last point is a good rule: the admin panel is not a separate user class. It is one permission
that happens to be the widest. Everything else is ordinary data.

### 1.2 Users

The user record carries more than an address:

- display name, email, username, avatar;
- `is_active` — whether the account may sign in at all;
- timezone and language;
- `email_verified`, with a token and expiry when the identity provider does not vouch for it;
- `requires_password_reset`, created/updated timestamps;
- `is_system_admin` (derived, cached at login);
- `is_agent` and an owner for service accounts;
- SCIM fields, for directory-managed accounts that must not be edited locally.

The admin user list shows **name, email, username, status and last activity**, and the row menu
offers:

| Action | What it does |
| --- | --- |
| Create user | Username and password set by the administrator |
| Invite user | Creates the account, returns an **invitation link to copy** from the dialog |
| Edit | Name and email |
| Reset password | Sets a new password |
| Deactivate / Activate | Controls sign-in |
| Delete | Removes the account **and its sessions** |
| Erase | A separate data-subject operation, not a delete |

Two guardrails are explicit in the product: **you cannot deactivate or delete your own account**,
and a separate erase flow exists because "remove the account" and "erase the person's data" are
different promises.

### 1.3 Groups

A group is a named set of users, used so a permission or workspace role is granted once. Groups can
be active or inactive (an inactive group grants nothing), some are system groups that cannot be
deleted, and directory-synced groups cannot be edited by hand. A group holds global permissions and
workspace roles; assigning a role to a group applies it to every member.

Groups are the answer to "the same twelve people need Editor on six boards". They are not needed on
day one, but the model leaves room for them.

### 1.4 Sign-in policy and sessions

The Security page chooses **one policy for the instance**:

| Policy | Effect |
| --- | --- |
| Password | Standard password sign-in; SSO also available when configured |
| Password + passkey | Password, then a registered passkey as a second factor |
| Passkey only | A password becomes an enrolment credential only |
| SSO only | The provider is the only door; requires SSO |

It can run in **preview mode** (warn, do not block), shows user statistics — total users, SSO users,
users with and without a passkey, system administrators separately, and the users a policy would
affect — and has an **administrator fallback** so a recovery door exists when SSO is down.

Sessions are secure, HttpOnly cookies, 256-bit, **24 hours by default and 30 days with "remember
me"**, and each row records IP address, user agent, expiry and activation. `SESSION_IP_BINDING`
chooses what a changed IP does: `log` (default), `strict`, or `off`.

### 1.5 Profile and security

The profile is personal, not administrative, and has tabs for avatar, regional settings (timezone,
language), agents, calendar feed, connected source-control accounts, personal labels and leave. The
security page has credentials (FIDO2 security key, TOTP authenticator, SSH key), change password, and
**API tokens with scopes, an optional expiry, and the token shown exactly once**.

The useful pattern is not the feature list. It is that **the user owns their own profile and
credentials; the administrator owns access to the instance**, and neither page can do the other's
job.

### 1.6 The admin surface

The Admin panel separates:

- **Users & Access** — users, groups, global permissions, workspace roles;
- **Security** — sign-in policy, feature switches, agent limits, user statistics;
- **Communication** — notification settings and email templates;
- **Configuration** — custom fields, screens, statuses, workflows, item types;
- **Operations** — audit logs, API tokens, Jira import, themes.

Every administrative mutation is written to an **audit log**, which has its own permission
(`admin:audit-logs:read`) and is readable through the API. Grant and revoke changes invalidate the
permission cache immediately, so a revoked person does not keep a cached "yes".

---

## 2. What Kanban Toolkit has today

Kanban Toolkit starts from a better place in one respect: **there is no password to manage**. Sign-in is
OAuth/OIDC only, with Google, Microsoft and one self-hosted provider, plus `AUTH_DEV=1`. That
removes password reset, password policy, TOTP and breach-checking from the whole product. It must
stay that way.

What exists:

| Piece | Where | What it actually is |
| --- | --- | --- |
| `users` | `migrations/0002_auth.sql` | `id`, `name`, `email`, `created_at` |
| `identities` | same | provider + subject → user, with the verified email |
| `sessions` | same | SHA-256 of the cookie token, user, expiry (fixed 30 days) |
| `members` | same | instance membership **and** a role string (`owner`/`member`/invite role) |
| `invites` | same | an email plus a role, consumed on first sign-in |
| `auth_attempts` | same | per-IP attempt counts, for rate limiting |
| Sign-in routes | `server/auth/routes.ts` | providers, start, callback, session, signout, dev |
| Session handling | `server/auth/session.ts` | issue, read, revoke; no listing, no last seen |
| Account menu | `src/components/AccountMenu.tsx` | name, email, role label, sign out |
| Admin screen | `src/components/AdminView.tsx` | the browser's own workspace — snapshots, storage and the demo reset — beside the workspace and instance panels |

Four findings worth stating plainly:

1. **The instance is open.** In `identify()`, a verified address with no invite and no membership
   becomes a `member` as long as one person already owns the instance. Once a provider is
   configured, anyone with a Google/Microsoft account who completes the flow is in. Today that is
   the only behaviour available, and it is not a safe default for a team instance.
2. **The role is decorative.** `AuthUser.role` is returned by `/api/auth/session` and printed in the
   account menu, but no route checks it. There is no `requireRole`, no permission function, and no
   server-side action a role could govern yet.
3. **An invitation is only an email row.** No token, no expiry, no list, no revoke, no link to copy,
   and no record of who invited whom. It is spent the first time that address signs in, whichever
   provider it uses.
4. **There is no lifecycle.** No `is_active`, no last activity, no session list, no self-protection,
   no last-admin guard, no audit trail, no account deletion or erasure. Task 126 is the promise;
   this is the machinery.

The local-first tier must survive all of this. A person with no account keeps a working board, and
every new admin call must fail soft exactly as `src/lib/auth.ts` already does.

---

## 3. The model to adopt

### 3.1 Three layers, not one

Copy Windshift's separation, but with Kanban Toolkit's smaller vocabulary:

```
instance access     who may sign in at all        instance_role: admin | member
workspace role      what they may do here         viewer | editor | admin
board sharing       what an outsider may see      (task 123, later)
```

The current `members` table conflates the first two. Split it:

- **`instance_members`** — `user_id`, `instance_role`, `created_at`. This is the door.
- **`workspace_members`** — `workspace_id`, `user_id`, `role`, `created_at`, `invited_by`. This is
  the authority inside.

A person can be an instance member without being a member of a particular workspace (the seed of
multi-workspace support), and an instance administrator can administer any workspace without
automatically being listed as one of its members. That second rule is Windshift's `system.admin`
bypass, and it is the right one for a self-hosted team tool: someone has to be able to fix a
workspace they are not on.

**No groups in v1.** They are the correct answer at scale, but a group table, membership table and
UI is a week of work that only pays off after several workspaces exist. Leave the `workspace_members`
row as the single assignment point so a `group_workspace_roles` table can join it later without
rewriting the permission check.

### 3.2 Roles and what they may do

Three roles, closed set, defined in the domain as data and read by one function. Display names are
capitalised; the wire values are lower case.

| Action | Viewer | Editor | Administrator |
| --- | --- | --- | --- |
| Open boards, read cards, initiatives, objectives, metrics, activity | ✓ | ✓ | ✓ |
| Search, filter, export a board, use the command palette | ✓ | ✓ | ✓ |
| Comment on a card, read its history | ✓ | ✓ | ✓ |
| See the people directory (names only) | ✓ | ✓ | ✓ |
| Create, edit, move, rank a card | | ✓ | ✓ |
| Create an initiative; set a parent, dependency, tag or checklist | | ✓ | ✓ |
| Attribute an initiative to an objective | | ✓ | ✓ |
| Create and edit a board from a template | | ✓ | ✓ |
| Split, add, rename, reorder or remove a lane or a cards flow; flip orientation | | | ✓ |
| Set WIP limits and the WIP policy; edit board settings and bindings | | | ✓ |
| Archive a board; delete a card; delete a board; remove a template | | | ✓ |
| Import a workspace; restore a snapshot | | | ✓ |
| Create and revoke a read-only share link (123) | | | ✓ |
| Invite, remove, or change the role of a workspace member | | | ✓ |
| Configure the workspace (name, people list) | | | ✓ |

Two rows are genuinely a product decision and should be settled before implementation:

- **Board design.** Windshift's Editor may edit items but not workspace configuration; the
  analogous Kanban Toolkit line is *work* versus *board design*. Lane surgery can throw away a column's
  shape, and it is asynchronous for everyone looking at the board, so keeping it with Administrator
  is the safer default.
- **Attribution.** Mapping an initiative to an objective is a management act, but it is also
  planning work. Recommendation: Editor may attribute; only Administrator creates or deletes
  objectives and key results.

The permission check is a pure domain function, not scattered conditionals:

```ts
// src/domain/roles.ts
export type Role = 'viewer' | 'editor' | 'admin'
export type Action =
  | 'board.read' | 'item.read' | 'item.comment'
  | 'item.write' | 'item.move' | 'item.attribute'
  | 'board.design' | 'board.delete' | 'item.delete'
  | 'workspace.settings' | 'workspace.members' | 'workspace.share'

export function can(role: Role, action: Action): boolean
```

It is unit-tested like every other domain rule, and it is the **only** place the matrix lives. The
server middleware calls it; the UI calls it to hide or disable controls. The UI call is a courtesy,
never the enforcement: a hidden button is not a permission check.

### 3.3 The rules that make roles safe

These are the non-obvious parts, and each one prevents a real failure:

1. **Closed, always.** Every person needs an account. An address arrives by invitation, or from a
   domain an administrator lists; there is no open sign-up. This is the fix for finding #1 above.
2. **The first person is the administrator.** First-run creates `instance_role = admin` and
   `workspace_members.role = admin` in the same transaction as the workspace.
3. **The last administrator cannot be demoted, deactivated, deleted or removed.** The server refuses
   before writing, like `setParent` refuses a cycle. The UI disables the control and says why. This
   is Windshift's last-`system.admin` rule, and it is the one guardrail a self-hosted instance
   cannot do without.
4. **You cannot deactivate, delete or demote yourself** if it would leave no administrator. Plain
   self-deactivation is also refused, as in Windshift, so a mis-click cannot lock the only operator
   out.
5. **No "everyone fallback".** Windshift grants combined Viewer/Editor/Tester when no explicit role
   exists, and turns it off once any Viewer assignment is made. That is a migration convenience for
   an existing product, not a security model. Kanban Toolkit should have **no implicit edit rights**: a
   member with no `workspace_members` row is a Viewer of the public surfaces at most, or has no
   access to that workspace at all. Make it explicit, with a test.
6. **A role change is effective on the next request.** Read `workspace_members.role` in the
   middleware; do not cache it in the session. Kanban Toolkit's scale does not justify Windshift's
   15-minute permission cache, and a stale cache is a bug that looks like a security hole.
7. **A role does not change who you are.** History keeps the author; an inactive or removed member's
   name still appears on the log, rendered as "Former member" if the account is erased.

### 3.4 The lifecycle

```
invited ──sign in──► active ──deactivate──► inactive
                       │                      │
                       │◄─────activate────────┘
                       │
                       ├──delete──► account gone, history keeps a name
                       └──erase───► account gone, personal data removed, id kept
```

**Active / inactive** is a property of the account, not of workspace membership. One switch affects
every workspace, which is what "this person has left the company" means.

| Layer | What inactive does |
| --- | --- |
| Sign-in | `identify()` refuses a new session; the message is the same generic refusal, so it does not confirm the account exists |
| Sessions | All sessions for that user are deleted in the same transaction |
| Identity rows | Kept, so reactivation resumes the same account and the same history |
| Invitations | Not accepted while inactive; an invite to an inactive account reactivates it only by an explicit admin choice |
| Assignments | Cards keep their assignee; the person is shown as inactive and is excluded from pickers by default |
| Directory | Listed under an "Inactive" filter; hidden from the default list and from mention/search suggestions |
| Counting | Not counted as a seat or an active member wherever the UI shows a count |
| Deletion | Not permitted while a workspace role would orphan the last administrator |

**Delete** removes `users`, `identities`, `sessions`, `instance_members` and `workspace_members` in
one batch. It **does not cascade into item history**. `ItemLogEntry.by` is an optional id and the
existing UI already handles a missing author; a deleted person's entries become "Former member" and
their cards stay assigned to a ghost until someone reassigns them. The alternative — cascade — would
erase the team's record of what happened, which is worse than a dangling name.

**Erase** is the data-subject operation and is not the same button. It replaces name, email and
avatar with neutral values, deletes identities and sessions, keeps the id and the log's `by` field
so referential integrity and history survive, and writes an audit event. It exists because "we
deleted the account" and "we erased the person" are different claims to make to a regulator. Task
126 owns the copy and the request flow; this document owns the mechanics.

### 3.5 Sessions

Keep the current design — a hashed token in an HttpOnly cookie — and add the fields a person needs
to answer "where am I signed in?" and an administrator needs to answer "why is this account still
active?":

- `user_agent`, `ip` (or a salted IP hash, matching the error-report precedent), `last_seen_at`,
  `created_at`, `expires_at`;
- `revoked_at` instead of relying on deletion, so a revoked session is explainable;
- two lifetimes: **30 days** by default, **12 hours** when the browser did not ask to be remembered.
  Windshift's 24-hour default is a better fit for a work tool than a permanent month;
- **sign out everywhere**, and automatic revocation on deactivate, delete, erase and email change;
- rotation on sign-in, so a session token is only ever issued by the callback;
- a `__Host-` cookie prefix in production, `Secure` whenever `PUBLIC_URL` is https even if the
  request behind the proxy arrived as http.

Do **not** copy IP binding in v1. `log` is harmless but noisy; `strict` breaks mobile and office
networks. If it is ever added, it is an operator setting with `log` as the default.

### 3.6 Audit

Windshift's audit log is the feature Kanban Toolkit will miss most after the first "who removed that
column?" conversation. One append-only table, written by the same middleware that performs the
mutation, not by each handler separately.

Record at least:

- sign-in succeeded, refused (inactive/open/rate-limited), sign-out everywhere;
- invite created, resent, revoked, accepted;
- user created, edited, deactivated, activated, deleted, erased;
- workspace role granted, changed, revoked;
- workspace settings changed, board archived, share link created/revoked;
- import and snapshot restore.

Each row: `at`, `actor_id` (nullable for system), `action`, `target_type`, `target_id`, `data`
(JSON, no secrets and no PII beyond the id), `ip_hash`. A retention window (90 days is enough for a
team tool) and a filter by actor, action and date. The audit page is readable by instance
administrators only; a workspace administrator sees the events for their workspace, not the
instance's.

---

## 4. Schema

`migrations/0003_people.sql` (applied by whatever 118.7 settles on; SQLite can add columns but not
change a primary key, so `invites` is rebuilt).

```sql
-- The account grows the fields a profile and a lifecycle need.
ALTER TABLE users ADD COLUMN avatar_url TEXT;
ALTER TABLE users ADD COLUMN timezone TEXT;
ALTER TABLE users ADD COLUMN language TEXT;
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';   -- active | inactive
ALTER TABLE users ADD COLUMN last_seen_at TEXT;
ALTER TABLE users ADD COLUMN updated_at TEXT;

-- The door: may this person use the instance, and as what?
CREATE TABLE instance_members (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',                                -- admin | member
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- The authority: what this person may do in one workspace.
CREATE TABLE workspace_members (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer',                                -- viewer | editor | admin
  invited_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (workspace_id, user_id)
);

-- An invitation is a token now, not an address pretending to be one.
CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',                                -- workspace role
  token_hash TEXT NOT NULL,
  invited_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT
);
CREATE UNIQUE INDEX invites_token ON invites (token_hash);
CREATE INDEX invites_email ON invites (lower(email));

-- A session is a device, and can be revoked without being forgotten.
ALTER TABLE sessions ADD COLUMN user_agent TEXT;
ALTER TABLE sessions ADD COLUMN ip_hash TEXT;
ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;
ALTER TABLE sessions ADD COLUMN revoked_at TEXT;

-- One append-only record of who changed access, and to whom.
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  actor_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  data TEXT NOT NULL DEFAULT '{}',
  ip_hash TEXT
);
CREATE INDEX audit_at ON audit_events (at);
CREATE INDEX audit_actor ON audit_events (actor_id, at);
```

Migration of existing rows:

- every `members` row becomes an `instance_members` row; `owner` → `admin`, `member` → `member`;
- every `members` row with `owner` becomes a `workspace_members` row with `admin`; `member` becomes
  `editor` (it preserves today's ability to edit, which is the least surprising default);
- existing invites become tokens with a 14-day expiry, or are dropped and re-issued — an old row
  cannot be turned into a link nobody has;
- `users.status` defaults to `active`, `updated_at` from `created_at`.

The `instance_role` and workspace `role` are separate columns on purpose. A person who administers
the instance is not automatically on every board's member list, and a workspace administrator is not
automatically an instance administrator. Collapsing the two is how "just make them an admin to fix
the board" turns into an instance takeover.

---

## 5. API

All admin routes below are ordinary `fetch` handlers in `server/`, shared by the Worker and the Node
entry. They return `401` when there is no session, `403` when there is one but not the authority,
`404` for a resource the caller may not see, `409` for last-administrator and self-protection
refusals, and `422` for validation.

### Me

| Method and path | Does |
| --- | --- |
| `GET /api/me` | The full profile: id, name, email, avatar, timezone, language, status, instance role |
| `PATCH /api/me` | Name, avatar, timezone, language (never email, never role) |
| `GET /api/me/sessions` | This account's sessions, newest first |
| `DELETE /api/me/sessions/:id` | Revoke one; revoking the session making the call is allowed and signs this browser out |
| `POST /api/me/signout-everywhere` | Revoke all, including the current one |
| `GET /api/me/identities` | Connected providers |
| `DELETE /api/me/identities/:provider/:subject` | Unlink; `409` if it is the last door |
| `DELETE /api/me` | Request erasure (task 126 flow, not an immediate cascade) |

### Admin — people

| Method and path | Does |
| --- | --- |
| `GET /api/admin/users` | Cursor-paged list; `q`, `status`, `role`, `provider` filters |
| `GET /api/admin/users/:id` | Profile, roles, sessions, last activity, audit for this user |
| `PATCH /api/admin/users/:id` | Name, email; email change revokes sessions and re-verifies through the provider |
| `POST /api/admin/users/:id/deactivate` | Status, revoke sessions, audit |
| `POST /api/admin/users/:id/activate` | Status, audit |
| `POST /api/admin/users/:id/sessions/revoke` | Revoke all sessions |
| `DELETE /api/admin/users/:id` | Delete account, keep history |
| `POST /api/admin/users/:id/erase` | Erase personal data, keep id |
| `PATCH /api/admin/users/:id/instance-role` | `admin` \| `member`, last-admin guard |
| `GET /api/admin/audit` | Filter by actor, action, target, date |
| `GET /api/admin/errors` | The error inbox task 107 promised |

### Admin — invitations

| Method and path | Does |
| --- | --- |
| `GET /api/admin/invites` | Pending, accepted, expired, revoked |
| `POST /api/admin/invites` | `{ email, role }` → creates token, returns the **link once** |
| `POST /api/admin/invites/:id/resend` | New token, old one dead |
| `DELETE /api/admin/invites/:id` | Revoke |
| `GET /api/invite/:token` | Public: is this invitation valid, and for what address? |
| `POST /api/invite/:token` | Accept after sign-in; the signed-in verified address must match |

### Workspace — members

| Method and path | Does |
| --- | --- |
| `GET /api/workspaces/:id/members` | Members, roles, pending invitations |
| `PATCH /api/workspaces/:id/members/:userId` | Change role; last-admin guard |
| `DELETE /api/workspaces/:id/members/:userId` | Remove from workspace, not from the instance |
| `POST /api/workspaces/:id/invites` | Invite into this workspace with a workspace role |

`GET /api/auth/session` should grow the resolved authority as **data**, so the UI can render the
right controls without a second round trip:

```json
{
  "user": { "id": "u_…", "name": "Maya Blake", "email": "…", "avatarUrl": null },
  "instanceRole": "member",
  "workspaces": [{ "id": "w_…", "role": "editor" }]
}
```

No route may trust that payload. It is for the UI; the middleware reads the tables.

**Invitation tokens** are 32 random bytes, hashed at rest, single-use, valid for 14 days, and shown
once. The endpoint answers `204` whether or not the address already has an account, so an
administrator cannot use it to enumerate the directory. Accepting an invitation after sign-in is
what binds the role — not the address alone — so a forwarded link cannot hand out Editor to whoever
opens it first.

---

## 6. Screens

`AdminView` already exists and already answers "what does this browser hold". Do not replace it.
Extend it with sections that only appear when the instance has accounts and the viewer is an
instance administrator; the static tier keeps exactly the snapshots it has today.

```
Admin
├── Workspace         its name
├── People            search, filters, table, row menu, bulk actions, invite, roles
├── Invitations       pending / accepted / expired / revoked, copy link, revoke
├── Audit             export the trail as a file
├── Tools & agents    agent tokens, directory provisioning
├── Snapshots         the browser's copies, and the demo reset
├── Workspace data    export, import, and what the browser keeps
└── Danger            delete this workspace
```

**People table** — avatar + name, email, workspace role, status, last active, provider, joined.
Sort by last active or name; filter by role and status; search name and email. The row opens a
drawer rather than a full page, because every other person-shaped surface in Kanban Toolkit is a drawer.

**Row menu** — Edit profile, Change role, Resend invitation (if pending), Deactivate/Activate,
Revoke sessions, Delete, Erase. Destructive items are last, separated, and require typing the email
for delete and erase. The current user's own row has Deactivate and Delete disabled with a reason,
not hidden without explanation.

**Invite dialog** — email, role (Viewer / Editor / Administrator with one sentence each), expiry,
then a link with a Copy button and the sentence "This link is shown once." If the instance can send
email later, it becomes a checkbox; it must not be a dependency now.

**Banners**, following the existing `StorageBanner` pattern:

- *development switch on* — "Sign-in can be bypassed with an email address. This is for development
  only." (mirrors `AUTH_DEV`).
- *no provider configured* — "Accounts are unavailable on this instance. Boards remain local."

**Account menu** — avatar, name, email, then Profile, Security, Admin (only for an instance
administrator), Sign out. Today it prints `role` as a word; replace that with the workspace role and
the administrator-only entry, because a role label is not a control.

**Profile** — identity (avatar, name, email read-only with "Change at your provider"), regional
(timezone, language), sessions with device and last seen, connected accounts, sign out everywhere,
danger zone. **No password section**, because there is no password to change.

The honest scope note: do not build a theme editor, leave management, personal labels, calendar
feeds or agents from Windshift's profile. Those are features of a different product. The four that
matter here are identity, regional settings, sessions and erasure.

---

## 7. Sequence

The order matters because roles cannot be retrofitted cheaply once server-side writes exist.

### P0 — before the first server-side write (fits inside 118.2/118.3, and 122)

1. `src/domain/roles.ts` with `can()`, the matrix, and unit tests — no server, no UI.
2. `instance_members` / `workspace_members` split and the migration mapping; first-run admin.
3. Middleware: `requireInstanceAdmin`, `requireWorkspace(role, action)`; reads live, no cache.
4. A closed instance: `identify()` refuses every uninvited address; there is no open posture to set.
5. Deactivation fields and semantics; sessions revoked on deactivate/delete.
6. Last-administrator and self-protection guards, in one function, with tests.
7. Invitation tokens with expiry and single use; role applied at acceptance.

**Ends with:** a second person can be invited as Viewer, cannot write, and cannot be let in by
forwarding the link; deactivating them ends their sessions immediately.

### P1 — the surface (122)

8. Admin → People list and drawer; edit, role change, deactivate, delete.
9. Admin → Invitations; copy link, revoke, resend.
10. Account menu → Profile; name, avatar, timezone, language.
11. Audit table and the events the P0 routes write.
12. Admin → Workspace members and roles.

**Ends with:** an administrator can run the instance from the product, and every change is
attributable.

### P2 — the conveniences

13. Session list and sign-out-everywhere.
14. Allowed email domains as an alternative to invitations.
15. Bulk actions on the people table; CSV export.
16. Error inbox on Admin → Health.
17. Delete vs erase, with the request flow from 126.
18. Board share links (123) under the Administrator role.

### P3 — only when a customer asks

19. Groups, so a role can be granted once to many.
20. A custom role label that routes approvals but **grants no permissions** — Windshift's deliberate
    choice, and the only safe way to offer custom roles.
21. API tokens with scopes (needs an API worth calling).
22. Passkeys or a second factor (needs a password or a non-OIDC fallback; not before).

### Acceptance tests, written before the screens

- `can()`: every role × action pair, one assertion each. Viewer cannot `item.write`; Editor cannot
  `board.design`; Administrator can both.
- An inactive account cannot complete sign-in and has no live sessions afterwards.
- The last administrator cannot be demoted, deactivated, deleted or removed; a second administrator
  makes all four possible.
- A person cannot deactivate or delete themselves.
- An invitation is valid once, expires, and cannot be accepted by a different verified address.
- A Viewer's `PATCH /api/items/:id` is `403`, and no row changes.
- A role change takes effect on the next request, without re-login.
- Deleting an account leaves its log entries readable and its cards assigned to a former member.
- Erasing keeps the id, removes the email, and writes one audit event.
- The static build still boots with no server and shows the snapshot admin page, unchanged.

---

## 8. What not to copy

| Windshift | Why Kanban Toolkit should not | What to do instead |
| --- | --- | --- |
| Password sign-in, reset, TOTP, SSH keys | OIDC removes the entire credential surface, and every credential is a support burden | Stay OAuth/OIDC only; add a second factor only if a real deployment requires it |
| SAML, LDAP, SCIM | Pro/enterprise integrations; OIDC covers self-hosters and small teams | One configurable OIDC provider; revisit on demand |
| Groups (v1) | A table, a UI and a permission join before there is a second workspace | Single `workspace_members` row; leave the join point |
| Permission sets, direct permissions | Ten global keys and a grant UI for a product with one authority | Two instance roles, three workspace roles |
| The Everyone fallback | Implicit edit rights for every member is a migration convenience, not security | Explicit membership; closed by default |
| Custom roles that grant permissions | Combinatorial testing and confusing effective rights | No custom roles; a label-only role at most, and only later |
| IP binding (`strict`), permission caches | Breaks mobile users; a stale cache looks like a breach | Read the role per request; no IP binding |
| Agents, service accounts | Needs an API, token scopes and an owner model; no current customer | Defer behind API tokens |
| Calendar feeds, leave, personal labels, themes | Profile features of another product | Identity, regional settings, sessions, erasure |
| "Tester" as a role | Kanban Toolkit has no test module; a role with nothing to gate is noise | Three roles only |

The general rule: copy the **separation** (instance vs workspace, user-owned profile vs
administrator-owned access) and the **guardrails** (last admin, self-protection, inactive means
sessions end, audit every change). Do not copy the **breadth**, which exists because Windshift sells
to enterprises with twenty roles and directory sync. Kanban Toolkit's advantage is that it can be
understood in an afternoon.

---

## 9. Open questions

1. **One workspace or many?** The schema above supports many; the UI today has one. If Kanban Toolkit is
   one workspace per instance forever, `workspace_members` can carry `workspace_id = 'default'` and
   the complexity is invisible. Decide before 118.2 so the table is not renamed later.
2. **Can an instance administrator read a workspace they are not a member of?** Windshift says yes
   (bypass). For a self-hosted team tool that is defensible; for a hosted multi-tenant product it is
   not. The answer changes the middleware, not the schema.
3. **Is a non-member a Viewer or denied?** "Viewer of public boards only" is friendlier;
   "denied" is simpler to reason about. Recommendation: denied, with an explicit Viewer invitation,
   so access is always a decision someone made.
4. **Editor and board design.** The matrix above keeps design with Administrator. If teams find that
   too strict, moving `board.design` to Editor is a one-line change to `can()` — which is the point
   of putting it there.
5. **Invitations by email or by link?** Link-only is honest about not sending mail, but a copied
   link is a bearer token. The token model above makes it single-use and expiring; sending the email
   later narrows the window without changing the model.
6. **What does "last active" mean?** Last successful sign-in, or last authenticated request? The
   former is cheap and stable; the latter needs a write per request. Recommendation: update
   `last_seen_at` at most once per hour, on any authenticated request.
7. **Retention.** 90 days of audit is enough for a team tool; the error inbox already has its own
   hourly cap. Both need a deletion path before a hosted tier.
