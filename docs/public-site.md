# The public site

Flowline is open-source software people self-host, and each workspace is a separately hosted
instance of it (the decision of 2026-10-24). That makes the site a *project's* site: there is nothing
to sell, no plan to compare and no shared sign-in page, because a person signs in at their own
instance, on their own domain. What the site owes a visitor is what this is, how to run it, where the
documentation is, and what the licence lets them do.

The backlog holds the work: tasks **163–167**, over the shipped 151 and the cancelled commercial set
(153, 155, 156, 161, 162). This holds the shape, the page inventory, the content outline and the
decisions, in the order the site needs them.

## What this is, and what it is not

**It is** the front door, the argument, the install path, the guide, the trust set, status and
support, the changelog, the pages a machine reads (404, sitemap, robots, social cards) — and a link to
the documentation, which lives with the code rather than on this site.

**It is not** a shop. No pricing table, no plans, no trials, no invoices, no refund policy, and no
account created from a form on this domain.

**It is not** a content-marketing programme either. There is no blog, no customer stories and no
careers page in this plan, for the reasons at the end. A stale blog and a testimonial nobody gave are
both worse than an empty slot.

## The shape

One origin, one build, one deploy. The app already ships as plain static files and runs with no
backend; the site is the same kind of thing and must not change that.

- **`/` is the home page. The app lives at `/app`.** Every app URL keeps its query
  (`/app?board=b-atlas&view=dashboard&item=…`), and `/?board=…` is redirected to `/app?board=…` so no
  link that exists today breaks.
- **The site is static HTML, and it needs no JavaScript to read.** Pages are rendered at build from
  `site/` into `dist/`, each with its own `<title>`, description, Open Graph tags and canonical URL.
  There is no server-rendered page: nothing on the site has to check something now.
- **The site's CSS is its own and small.** The app's bundle is not downloaded to read the home page.
  No third-party fonts, scripts or images: the same rule as the app, and the reason there is no
  cookie banner to show.
- **No tracking, so nothing to consent to.** The only cookie is the session's, set after sign-in.
- **The crawler policy is per surface.** Public pages are indexable; the app is not — its pages are
  private work, and a search result naming a board would be the leak. `X-Robots-Tag: noindex` belongs
  to `/app` alone.
- **One workspace per instance.** The site never implies a hosted service with several workspaces,
  because there is no such thing: a deployment *is* a workspace (task 163), and the demo at `/app` is
  the one board anybody can look at without installing anything.

The build:

```
site/pages/**            one file per page, with its content and its own head
site/layout.html         nav + footer, shared
site/site.css            the site's own styles, no app bundle
scripts/build-site.ts    renders the pages into dist/, writes sitemap.xml and robots.txt
app/index.html           Vite's entry: the app, emitted to dist/app/
```

`npm run build` is `tsc -b && vite build && node scripts/build-site.ts`. Node 26 strips types, so the
build script is TypeScript and may import the existing markdown renderer (`src/lib/markdown.ts`)
without a loader.

## The pages

| Path | What it is for | JS | Indexed | Task |
| --- | --- | --- | --- | --- |
| `/` | what it is, and the two things a visitor can do: the demo, or install | no | yes | 152 (done), 164 |
| `/product/` | how the model works, with the real UI | no | yes | 152 (done) |
| `/install/` | how to run it: one command, the configuration, TLS, and where the runbook is | no | yes | 164, 160, 128 |
| `/privacy/` | what the demo holds, who processes it, how to take it away | no | yes | 150 (done) |
| `/terms/` | the terms of open-source software you run yourself | no | yes | 150 (done) |
| `/security/` | how it is built, and what we do not claim | no | yes | 157 |
| `/sub-processors/` | every processor the demo is configured with | no | yes | 157 |
| `/app` | the application | yes | no | 151 (done) |
| `/404.html` | the page that says the path was wrong | no | no | 151 (done) |
| `/robots.txt`, `/sitemap.xml` | what a machine reads | — | — | 151 (done) |
| — | the documentation | — | — | 167 |

**Gone, and not coming back:** `/pricing/` (nothing is sold), `/signup/` (nobody signs up for a
workspace — they install one), `/signin/` (you sign in at your instance, not at the project's site),
`/app/account/billing`, `/refunds`, `/dpa`, `/about`, `/licence`, `/accessibility` and `/support` as
separate pages. Where one of them carried something still owed — the address to write to, the licence,
the accessibility target — it moves into the page that now owns it: support into the footer of every
page, the licence into `/install/` and the repository, accessibility into `/security/` and the issue
tracker.

**Removed 2026-10-24, after shipping:** `/help/`, `/status/` and `/changelog/`. The answers a person
needs live in the documentation (task 167) and in the app's own words; a status page for a deployment
nobody is on call for is a promise of monitoring this project does not have; and a change log on the
site duplicates the repository's own history and releases. The support address is in the footer of
every page, and the security address is in `security.txt`.

## What each page says

### `/` — the home page

One screen must answer three questions: what is this, why is it different, and what do I do next.

1. **Nav** — Product · Install · Docs · Help · Changelog · Status, then **Sign in** (`/app`) and the
   primary action **Install** (`/install/`). One line, no mega-menu.
2. **Hero** — an H1 in the product's own words, not a category label: *the truth is derived, not
   typed* is the claim the whole app is built to keep. One sentence under it naming the two audiences
   (the team's flow, management's read of it) and the one promise they share: nothing is entered
   twice. Two actions: **Open the demo — no account**, because the seeded board is the product's best
   argument and it needs no server at all, and **Install**.
3. **The strip under the hero** — four short, checkable facts, each a link into `/product/`: one card
   on several boards with one identity; status rolled up from the work, never typed; edits made
   offline land when the line comes back; no trackers, no third-party scripts.
4. **The product, shown** — one real screenshot of the shipped board (captured from the built app,
   never a mock-up), with alt text that describes what it shows.
5. **The three ideas** — the graph, derived facts, and one truth for two audiences. Three paragraphs,
   each ending in the consequence for the reader.
6. **How it starts** — open the demo, shape a board, install it when it needs to be yours.
7. **Who it is for** — three situations, plainly: the programme whose board no longer matches the
   work; the team whose column names are its own; the person who reads for a living and is tired of
   asking. No invented logos, no invented quotes.
8. **The promises that are unusual** — no trackers; your export always works; it runs on your own
   machine, from one process and one file. Each links to the page that proves it.
9. **Questions** — four, with real answers: Do I need an account? What happens offline? How do we run
   it ourselves? Do you train anything on our data?
10. **Footer** — the brand and one quiet line of small print (the licence, the privacy notice, "no
    tracking, no cookies" and the security address), then two groups: **Product** (the board, private
    by default, the live demo, install) and **Project** (the documentation, the REST and MCP docs,
    GitHub, the support address). Four groups of promotional labels was more footer than product;
    the shape is super-productivity's — a name, a handful of destinations, the licence said once.

**There is no cost section and no "how is this free?" section.** There is nothing to sell and nothing
to explain away, and a paragraph about being free is still a paragraph about money. What stands in
its place is evidence: the licence, the install page, the demo.

**The rule for every sentence:** it must be true of the code in this repository, and there must be
something to point at. A claim with no proof does not ship.

### `/product/` — how it works

The page the home page's claims link to, for the reader who has decided to care. Sections, each one
short paragraph plus one screenshot, in this order: one card, many boards; the lane tree and the four
stages; initiatives computed from the work below; dependencies that clear themselves; the same graph
read at three flight levels; what is deliberately not automatable (no generated cards, no AI guesses —
the app never writes what nobody wrote). Ends with the demo link and the install page, and nothing
about accounts or plans.

### `/install/` — running it

The page the home page's action points at, and the only place on the site that answers "how do I have
this". It is the short path, not the manual:

- **What it is**: one Node process, one SQLite file, a directory of static files, and the same routes
  and rules as the Cloudflare Worker build.
- **Two roads**: `docker compose up -d` (one command, one volume — what CI builds and runs), and the
  three commands that image performs, for a machine without Docker. Both are quoted exactly as they
  are run, and the site check fails if either drifts.
- **What the first run does**: the migrations, the workspace named by the installation, and the first
  account as its administrator (task 163).
- **What you take on**: TLS, updates, backups, and being the support — four jobs, named as jobs.
- **The honest limits**: one instance, the file is the database, no horizontal scale, the live channel
  is one process, and no hosted backups or support. There is no reduced edition and nothing to unlock.
- **Keeping it up**: upgrade and restore in three lines each, ending at the docs' drill.
- **The licence**, named and what it asks (task 165).
- **Where to go next**: install, container, configure, TLS, upgrade and backup, by name — six links to
  the documentation, plus the help page and the demo (task 167).

It replaces `/self-host/`, which is deleted: two pages about running it would be two pages that can
disagree, and the install page is the one a visitor needs. The *argument* for running it yourself is
not a page — it is three sentences on the home page, and the licence.

### The trust set

- `/privacy` and `/terms` — task 150's pages, already shipped. They name no payment provider, because
  there is none. A self-hoster is the controller of their own instance's data, and the notice says so
  plainly.
- `/sub-processors` — a table of every processor the **demo** is configured with: name, purpose, data,
  location, their terms. The list is derived from the deployment's own configuration wherever it can
  be, so it cannot quietly go stale.
- `/security` — how it is built (TLS, storage, hashed reporting IPs, no third-party scripts, no
  training on customer data, access, backups, disclosure), what is **not** claimed (no SOC 2, no ISO,
  no pen-test certificate until one exists), the accessibility target and its known gaps, and where to
  report a hole. A statement of what has not been done is the difference between a security page and
  an advertisement.

## The documentation is not on this site

The docs are markdown in this repository, rendered by GitHub, and readable in a clone (task 167). The
site carries **Docs** in the navigation and the footer and points at them; it does not hold a second
copy, because a page that exists twice will drift and one of the two will be wrong.

If the docs later need search or a version per release, a `docs.` subdomain is generated from the same
files. It is not a second manuscript.

## The promises ledger

Every claim the site makes has a page and a proof. If a claim cannot be proved, it is cut.

| The site says | What makes it true |
| --- | --- |
| no third-party requests, no trackers | the CSP in `public/_headers`, an e2e that records every request the public pages make |
| nothing is entered twice | the derivation unit tests, `/product/` |
| offline edits land | the queue, `e2e/account.spec.ts` |
| one card, many boards | placements, `docs/data-model-v2.md` |
| your export always works | `src/lib/exportWorkspace.ts`, `e2e/workspace.spec.ts` |
| it runs on your own machine, from one process and one file | task 128, `npm run server`, `npm run smoke:node`, `/install/` |
| the same routes and rules on both runtimes | `docs/server-runtime.md`, the second CI lane |
| one instance, one workspace | task 163, the server's refusal to make a second |
| the licence | task 165, `LICENSE`, `/install/` |
| no account needed to look | the demo at `/app`, which runs with no server |
| delete and erase are different promises | tasks 144 and 126 |

Rows that are gone with the plans: the lapsed-plan fallback, the free tier's limits, "cancel any
time", and the plan-to-enforcement table.

## Decisions to take

Each is a written decision before the page that depends on it is built. The first four are settled;
the rest are open.

1. **Nothing is sold** — *settled*. No pricing page, no plans, no merchant of record, no invoices, no
   refund policy, no billing record. Tasks 153, 155 and 156 are cancelled, and task 166 removed what
   was built of them: the columns, the panel and the audit action.
2. **One workspace per instance** — *settled*. A deployment is a team, and the install creates it
   (task 163). There is no sign-up page and no workspace switcher.
3. **No sign-in page on this site** — *settled*. A person signs in at their own instance, through the
   app's own door. A page here could only be about somebody else's deployment.
4. **Where the app lives** — *settled*. `/app`, with `/` as the home page.
5. **The licence** — **open, and the one that blocks the repository going public.** AGPL-3.0 if a
   competing host should share its changes back; Apache-2.0 if adoption matters more. It is named in
   `LICENSE`, `package.json`, the README, the site footer and `/install/` (task 165).
6. **Where the project lives** — **open**. The repository's URL, and therefore the Docs link, the
   source link and the place a security report goes. Everything here assumes GitHub; the value is one
   constant in the build (`REPO_URL`), not a page.
6b. **Who operates this site, and the law that applies to it** — **open**. The terms have no
   governing-law clause and no legal entity, unlike the sites this shape was taken from, because there
   is no company yet. When there is one, the entity, its address and the jurisdiction go in `/terms`
   §1 and §13 — and *that* is also the moment a DPA or an imprint page becomes meaningful.
7. **The demo instance's identity** — **open**. `/privacy` and `/sub-processors` describe *this*
   deployment, so somebody has to run one, and it needs a name that is not "Flowline Cloud".

## Not planned, and why

- **A pricing page, or a "how is this free?" section** — there is no money in the product to explain.
- **A sign-in or sign-up page** — the instance's own door is the only one that means anything.
- **A hosted multi-tenant service** — the model the plans assumed, and the one task 163 removes.
- **A blog** — a channel, not a page. It needs a cadence; a blog whose last post is a year old argues
  against the product.
- **Customer stories, logo walls, testimonials** — there are no customers yet, and inventing proof is
  the one thing this project's house rules are most against.
- **Compare-us-to-them pages** — they date in weeks and are written about somebody else's product.
  `/product/` can carry the differences without naming a competitor.
- **Careers, press kit, brand page** — nothing to hire for or announce yet.
- **A template gallery** — the demo boards are the gallery; a separate page would be a second library
  to maintain.
- **A cookie banner** — there is nothing non-essential to consent to. Adding one would be a lie about
  what the site does.
- **Onboarding as a page** — the first five minutes are the demo board, not a tour.

## Order

```
163  the instance is the workspace   ──► 166  the bill leaves the schema
152  the home page (shipped)         ──► 164  the site is a project's site
160  the install page                ──► 128  install, upgrade, back up, restore
165  licence, contribution, security ──► 167  the docs live with the code
158  help       159  status       157  the trust set
```

164 comes first because it is the change that stops the site contradicting the product: it deletes
three pages, builds `/install/` and re-points every link that is now a dead end. 163 is its model
half. 165 and 167 come before the repository is announced, because a project with no licence and no
docs is a project nobody can run. 166 is cleanup that can follow, as long as it does.

## Launch checklist

Not a task, because it is a moment rather than work: every line must be true on the same afternoon.

- [ ] The domain resolves, HTTPS is on, and `SITE_URL` is the canonical origin everywhere.
- [ ] `REPO_URL` points at the real repository; the Docs, Source, Contribute and Licence links resolve.
- [ ] The licence is decided, in `LICENSE`, and named in `package.json`, the README, the footer and `/install/`.
- [ ] A fresh machine follows `/install/` and the docs from nothing to a running instance in under ten minutes.
- [ ] A real mailbox answers support and security; `security.txt` has an expiry in the future.
- [ ] `/pricing/`, `/signin/` and `/signup/` are gone, and nothing links to them.
- [ ] The Access gate is off, `/app` is `noindex`, every public page is in `sitemap.xml`.
- [ ] A backup exists and one restore has been performed (task 119).
- [ ] Somebody reads the support address in the footer, and the expectation they answer on is the one they can keep.
- [ ] The promises ledger above has no row without a green test.

## The rules this plan inherits

From `AGENTS.md`, without exception: the dependency rule binds the site exactly as it binds the app —
the forbidden services are named there, not repeated here, and `npm run scan` is the check. Sign-in
is the operator's own OIDC issuer, never a vendor the product chose. The site is static, so it adds no runtime
dependency to the app — and the app must still run, and still be usable, with no server at all.
