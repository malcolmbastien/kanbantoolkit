# One application, three places to run it

Flowline is meant to be both a service and a project: something you can use at a URL, and something
a team can run on a machine they own. That is a constraint on the code, not a plan for two of them.
There is one repository, one client, one API and one schema; what varies between deployments is
where the process runs and where the database lives.

## The three tiers

| Tier | What runs | Who it is for | Server |
| --- | --- | --- | --- |
| **Static** | `dist/` on any web server or CDN | anyone, today | none |
| **Self-hosted** | `dist/` + the Node entry + a SQLite file | a team that wants its own | Node |
| **Hosted** | `dist/` + the Worker + D1 | the public instance | Cloudflare |

The tiers are cumulative, not alternatives, and they are one artifact at three levels of
completeness rather than three builds: one client build, one API codebase, and two entry files that
are the only place code knows where it is running. The static tier is the whole app — every board,
every card, every rule — because the workspace lives in the browser. That is not a degraded mode,
and it must stay true: a person with no Docker, no SMTP and no identity provider still has a working
board. The server adds accounts, sharing and a second device, and takes nothing away.

## The contract: a `fetch` handler

The API is a function from `Request` to `Response`. Hono exposes one as `app.fetch`; the repository
already writes one by hand in `worker/index.ts`. Every runtime that matters speaks this, so the same
routes run on both:

- **Cloudflare** — `export default { fetch: app.fetch }`.
- **Node** — `serve(app.fetch)` from `@hono/node-server`.

Framework choice is therefore an implementation detail, and a reversible one. The contract is the
decision; Hono is how it is met today (see the note at the end). Task 129 builds this seam before
the first route exists, so that 117's callback and 118's tables are written once rather than in the
Worker and moved later.

## The boundary

What may live where:

| Path | May import | Must not |
| --- | --- | --- |
| `src/` | the browser, the domain, the store | anything server-side; the client stays static |
| `src/domain/` | nothing but itself | a runtime, a framework, a database |
| `server/` | web standards, the database interface | `cloudflare:workers`, `D1Database`, `env.ASSETS`, Cloudflare-only storage |
| `worker/` | everything in `server/`, plus Workers bindings | be the only entry that exists |

`worker/` is the Cloudflare *entry*: it wires bindings to the portable app and does nothing else. If
a route, a query or a rule is written there, it has been written in the one file a self-hoster
cannot run.

## The database

D1 is SQLite. So the schema is SQLite, the queries are SQLite, and `migrations/` is applied
unchanged in both deployments. The code reaches it through one interface:

```ts
export interface Database {
  all<T>(sql: string, params: unknown[]): Promise<T[]>
  get<T>(sql: string, params: unknown[]): Promise<T | undefined>
  run(sql: string, params: unknown[]): Promise<{ changes: number }>
  batch(statements: Array<{ sql: string; params: unknown[] }>): Promise<void>
}
```

Two implementations: D1 (`env.DB.prepare(…)`) and a driver over a file (`node:sqlite` or
`better-sqlite3`). Postgres, if it ever comes, is a third — behind the same interface, not a second
application.

What this rules out, deliberately: D1-only APIs (batch semantics beyond the interface, `meta`
fields, the HTTP admin API), Cloudflare-only storage (KV, R2, Durable Objects) in the core, and
`cf-connecting-ip` outside a single `clientIp(request)` helper.

## Why not an ORM

Drizzle would make `db.select().from(users)` identical on both tiers, and that is a real benefit. It
is not taken yet, for four reasons.

The schema would live in TypeScript and generate SQL, beside the `migrations/*.sql` that
`wrangler d1 migrations apply` already runs — two sources of truth and two migrators that have to
agree. D1 and `better-sqlite3` differ in transactions, batch semantics, prepared-statement reuse and
error shapes, which is exactly what an ORM hides until it does not. The query surface is small
enough — twenty to forty statements — that a thirty-line interface costs less than a dependency and
a codegen step. And the dialect is shared while the server is not: D1 refuses `ATTACH`, extension
loading and some pragmas, so "plain SQLite" still needs exercising on both.

The cost is honest: types are declared per statement rather than inferred. At twenty to forty
statements that is affordable; at two hundred it would not be, and Drizzle behind the same
`Database` interface would be the answer. The interface is the decision; the ORM is an
implementation detail.

## What genuinely differs

Four things, and each is a named seam rather than a scatter of `if (isCloudflare)`:

1. **The entry file** — the Worker's default export, or the Node listener.
2. **The database binding** — `env.DB`, or a file path.
3. **Static assets** — the asset router, or a static handler.
4. **The live channel** — a Durable Object on Cloudflare, a WebSocket server on Node, polling
   everywhere. Task 118.5 has to name the fallback, because a self-hosted instance has no Durable
   Objects to lean on.

Everything else — routes, SQL, rules, validation — is shared.

## Identity follows

A self-hoster cannot use the hosted instance's OAuth client: every deployment needs its own
registration, its own consent screen, its own secret. So providers are **configuration**, not code.
Google and Microsoft are the hosted defaults; an operator may configure their own OIDC endpoint, or
email, instead. This is why 117's R2 is about a provider list rather than two branches.

## The cost: a second CI lane

Two runtimes drift apart silently. The price of this architecture is that CI boots the Node entry
and replays the API paths the e2e suite already uses, so "self-hostable" is a test rather than a
claim. Without that lane the second entry rots and the README becomes false.

## Non-goals

- **No fork.** Not a "cloud edition" and a "self-host edition". One repository, two entry files.
- **No feature matrix.** A feature that only works on one deployment is a bug, unless it is named
  as a Cloudflare convenience — the live channel's Durable Object, for instance — with a fallback
  that works everywhere.
- **No required server.** The static tier depends on none of this.

## A note on the framework

Hono was chosen in October 2026 over h3 v2 (stable only days earlier, smaller ecosystem) and over
no framework (which would mean hand-writing body parsing, auth middleware and rate limiting). Its
middleware, its record and its `app.fetch` contract decided it. h3 v2 is the fallback if Hono's
shape ever chafes; because the contract is web standards, either swap is a weekend.

## Decisions

| Date | Decision |
| --- | --- |
| 2026-10-21 | One codebase, two runtimes; the API is a `fetch` handler. |
| 2026-10-21 | Providers are configuration; Google and Microsoft are the hosted defaults. |
| 2026-10-21 | SQLite-first schema behind a `Database` interface, so D1 and a file share it. |
| 2026-10-21 | The seam is built before the first route (task 129), not retrofitted after it. |
| 2026-10-21 | No ORM yet: plain SQLite behind the interface, with Drizzle as a later swap. |
| 2026-10-21 | Hono for the API; the framework stays reversible. |
| 2026-10-21 | The static tier stays complete; a server is never required to use the app. |
