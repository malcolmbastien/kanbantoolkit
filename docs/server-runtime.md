# One application, three places to run it

Kanban Toolkit is both a service and a project: something you can use at a URL, and something a team
can run on a machine they own. There is one repository, one client, one API and one schema; what
varies between deployments is where the process runs and where the database lives.

## The three tiers

| Tier | What runs | Who it is for | Server |
| --- | --- | --- | --- |
| **Static** | `dist/` on any web server or CDN | anyone, today | none |
| **Self-hosted** | `dist/` + the Node entry + a SQLite file | a team that wants its own | Node |
| **Hosted** | `dist/` + the Worker + D1 | the public instance | Cloudflare |

The tiers are cumulative: one client build, one API codebase, and two entry files that are the only
place code knows where it is running. The static tier is the whole app — every board, every card,
every rule — because the workspace lives in the browser, so a person with no Docker, no SMTP and no
identity provider still has a working board. The server adds accounts, sharing and a second device,
and takes nothing away.

### What this project deploys, and what a team deploys

The three tiers are what the code can do; this project does not run all of them. The site and the
documentation are the project's own — [the index](README.md) says what is in this repository — and an
instance is the application. The site behind `kanbantoolkit.com` is the static tier plus the demo:
`wrangler.jsonc` binds no database, so `/api/health` answers `503 {"database":"not configured"}`,
every route that needs one refuses, and `/api/auth/providers` reports no doors at all, so the sign-in
surface does not render. The demo keeps working because its workspace is in `localStorage`, as a
static copy on any host does.

**Uncommenting the `d1_databases` block is what makes a Worker deployment an instance**: the
self-hosted tier on someone else's account, a supported deployment with a CPU budget the Node entry
does not have.

### Passwords on Workers cost more CPU than the free plan gives

Hashing a password is expensive work, and it counts as CPU time:

| | |
| --- | --- |
| One PBKDF2-HMAC-SHA256 hash at 600 000 iterations | **~60 ms** (measured: 61 ms to hash, 60 ms to verify) |
| Workers Free, CPU per request | **10 ms** |
| Workers Paid, CPU per request | 5 minutes (default 30 s) |

On the free plan one password check is about six times the whole request budget, and the runtime
terminates the invocation — Cloudflare's `1102 Worker exceeded resource limits` — rather than signing
anybody in. Cloudflare's own guidance is blunter: *"heavy workloads that handle authentication …
typically use 10–20 ms"*, already at or over the free limit before the hashing starts.

Three ways out, and lowering the iteration count is not one of them:

1. **The paid plan.** 60 ms against 30 s is nothing, and `limits.cpu_ms` can raise it further.
2. **The Node entry.** A process on a machine the team owns, with no CPU meter — the documented
   deployment, and the one `/install/` describes.
3. **An identity provider.** With OIDC configured, nobody types a password into a Worker; the issuer
   does the expensive part. On Cloudflare this is also the free answer, and Cloudflare Access in
   front of the whole deployment is the same idea one layer out.

600 000 iterations is OWASP's current recommendation for PBKDF2-HMAC-SHA256. A number that fits 10 ms
would be roughly sixty times weaker, so the product offers no knob for it.

## The contract: a `fetch` handler

The API is a function from `Request` to `Response`. Hono exposes one as `app.fetch`; the repository
already writes one by hand in `worker/index.ts`. Every runtime that matters speaks it, so the same
routes run on both:

- **Cloudflare** — `export default { fetch: app.fetch }`.
- **Node** — `serve(app.fetch)` from `@hono/node-server`.

Framework choice is an implementation detail, and a reversible one: the contract is the decision, and
Hono is how it is met today (see the note at the end).

## The boundary

What may live where:

| Path | May import | Must not |
| --- | --- | --- |
| `src/` | the browser, the domain, the store | anything server-side; the client stays static |
| `src/domain/` | nothing but itself | a runtime, a framework, a database |
| `server/` | web standards, the database interface | `cloudflare:workers`, `D1Database`, `env.ASSETS`, Cloudflare-only storage |
| `worker/` | everything in `server/`, plus Workers bindings | be the only entry that exists |

`worker/` is the Cloudflare *entry*: it wires bindings to the portable app and does nothing else. A
route, a query or a rule written there has been written in the one file a self-hoster cannot run.

## The tenant is the deployment

One deployment is one team. A **workspace** comes with the installation, is named by it
(`WORKSPACE_NAME`, defaulting to `Kanban Toolkit`), and the first account to sign in administers it.
Everybody else arrives by invitation; a second workspace is refused with a sentence rather than a 404,
which is what `POST /api/workspaces` is for.

The `workspace_id` columns and the seal every route goes through stay: the session decides which
workspace a request is about, never the client. One workspace makes them redundant today, but they
are what a fork that wanted two would need. This application serves one team per deployment.

## The database

D1 is SQLite. So the schema is SQLite, the queries are SQLite, and `migrations/` is applied unchanged
in both deployments. The code reaches it through one interface:

```ts
export interface Database {
  all<T>(sql: string, params: unknown[]): Promise<T[]>
  get<T>(sql: string, params: unknown[]): Promise<T | undefined>
  run(sql: string, params: unknown[]): Promise<{ changes: number }>
  batch(statements: Array<{ sql: string; params: unknown[] }>): Promise<void>
}
```

Two implementations: D1 (`env.DB.prepare(…)`) and a driver over a file (`node:sqlite` or
`better-sqlite3`). Postgres, if it comes, is a third behind the same interface, not a second
application.

What this rules out: D1-only APIs (batch semantics beyond the interface, `meta` fields, the HTTP admin
API), Cloudflare-only storage (KV, R2, Durable Objects) in the core, and `cf-connecting-ip` outside a
single `clientIp(request)` helper.

## Why not an ORM

Drizzle would make `db.select().from(users)` identical on both tiers. It is not taken yet, for four
reasons.

The schema would live in TypeScript and generate SQL, beside the `migrations/*.sql` that
`wrangler d1 migrations apply` already runs: two sources of truth and two migrators that have to
agree. D1 and `better-sqlite3` differ in transactions, batch semantics, prepared-statement reuse and
error shapes, which an ORM hides until it does not. The query surface is twenty to forty statements,
where a thirty-line interface costs less than a dependency and a codegen step. And the dialect is
shared while the server is not: D1 refuses `ATTACH`, extension loading and some pragmas, so "plain
SQLite" still needs exercising on both.

The cost: types are declared per statement rather than inferred. Affordable at twenty to forty
statements, not at two hundred, where Drizzle behind the same `Database` interface would be the
answer.

## What genuinely differs

Four things, each a named seam rather than a scatter of `if (isCloudflare)`:

1. **The entry file** — the Worker's default export, or the Node listener.
2. **The database binding** — `env.DB`, or a file path.
3. **Static assets** — the asset router, or a static handler.
4. **The live channel** — a Durable Object on Cloudflare, a WebSocket server on Node, polling
   everywhere. The *transport* is the entry's, the channel is one interface, and the fallback is the
   feed that was already there.

   What travels is a nudge, `{"revision": n}`, never a change. A client that hears one reads
   `GET /api/workspace/changes?since=<cursor>`, the same request it would have made on a timer, so a
   deployment with no socket, or a browser that cannot open one, is two seconds behind rather than a
   different application. The entry says which in `/api/auth/session`: `live: 'socket'` or `'poll'`,
   and the client falls back on its own if a socket fails.

   The bell is rung after the write that moved the feed, in `server/workspace/routes.ts`, through
   `Runtime.live.publish`, the one line that knows a channel exists. On Cloudflare that reaches
   `WorkspaceChannel`, one Durable Object per workspace, holding hibernatable sockets so an idle
   channel costs nothing. On Node it reaches an in-process map of listeners, which is the whole
   channel for one process. With `LIVE=0` the Node entry has no channel at all, and CI runs the
   e2e suite against both that instance and the socketed one.

Everything else — routes, SQL, rules, validation — is shared.

## Identity follows

A self-hoster cannot use the hosted instance's OAuth client: every deployment needs its own
registration, consent screen and secret. So providers are **configuration**, not code: the identity
provider is the operator's own OIDC issuer, with no vendor table in the code, or email.

## The cost: a second CI lane

Two runtimes drift apart silently. CI boots the Node entry and replays the API paths the e2e suite
already uses, so "self-hostable" is a test rather than a claim. Without that lane the second entry
rots and the README becomes false.

## Non-goals

- **No fork.** Not a "cloud edition" and a "self-host edition". One repository, two entry files.
- **No feature matrix.** A feature that only works on one deployment is a bug, unless it is named as a
  Cloudflare convenience — the live channel's Durable Object, for instance — with a fallback that
  works everywhere. That fallback is the same feed, read on a timer instead of when a bell rings.
- **No required server.** The static tier depends on none of this.

## A note on the framework

Hono was chosen in October 2026 over h3 v2 (stable only days earlier, smaller ecosystem) and over no
framework (which would mean hand-writing body parsing, auth middleware and rate limiting). Its
middleware, its record and its `app.fetch` contract decided it. h3 v2 is the fallback if Hono's shape
ever chafes; because the contract is web standards, either swap is a weekend.

## Decisions

| Date | Decision |
| --- | --- |
| 2026-10-21 | One codebase, two runtimes; the API is a `fetch` handler. |
| 2026-10-21 | Providers are configuration; Google and Microsoft are the hosted defaults. |
| Later (task 154) | *Superseded.* No vendor provider is built in. An instance signs people in with the operator's own OIDC issuer, a password, or a magic link. |
| 2026-10-21 | SQLite-first schema behind a `Database` interface, so D1 and a file share it. |
| 2026-10-21 | The seam is built before the first route (task 129), not retrofitted after it. |
| 2026-10-21 | No ORM yet: plain SQLite behind the interface, with Drizzle as a later swap. |
| 2026-10-21 | Hono for the API; the framework stays reversible. |
| 2026-10-21 | The static tier stays complete; a server is never required to use the app. |
| 2026-10-24 | The live channel is a nudge, not a payload: the feed stays the only way a change enters the store, so one shape and one cursor serve every transport. |
