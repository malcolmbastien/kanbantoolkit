# Configure

Almost every value Kanban Toolkit reads is an environment variable with a default that works. Set
nothing and you get a running board with no way in, which is the static tier. `ERROR_SALT` is the
exception: an instance refuses to start without it.

Two rules hold everywhere:

- **A variable that is unset is absent, not empty.** `AUTH_OIDC_CLIENT_ID=""` and no variable at all
  are the same thing, and neither draws a button that cannot work.
- **Secrets live in the environment.** Not in this file, the database, or the built files in `dist/`,
  which hold no secrets and can be rebuilt from the repository.

## Where the values come from

| Runtime | How it reads them |
| --- | --- |
| **Node** (self-hosted) | `process.env` — a systemd unit, a `.env` your process manager loads, or the shell |
| **Cloudflare** | Worker bindings and `vars` in `wrangler.jsonc`; secrets with `wrangler secret put` |

The application code never reads either directly. `server/config.ts` is the only file that maps a
binding or an environment variable to a setting, which lets one set of routes run on both.

## The core

| Variable | Default | What it does, and what happens when it is unset |
| --- | --- | --- |
| `PORT` | `8787` | The port the Node entry listens on. Unset is the default; a proxy forwards to it. |
| `DB_PATH` | `./kanbantoolkit.db` | The SQLite file. Unset puts it beside the working directory. The file **is** the instance. |
| `STATIC_DIR` | `./dist` | Where the built site and app are. Unset assumes `dist/` under the working directory. |
| `WORKSPACE_NAME` | `Kanban Toolkit` | What the installation calls the team, used when the workspace is created. It changes later only while the name is still the default set then; a name someone chose is never overwritten. |
| `PUBLIC_URL` | the request's own origin | The address people use to reach the instance. Sign-in redirects are built from it, and an `https` address makes the session cookie `Secure`. Set it behind a proxy. |
| `LIVE` | on | Set to `0` to switch the live channel off. The app then polls the same feed, as on any host without a socket server. |
| `WEBHOOKS` | on | Set to `0` to stop the outbound delivery timer. Events are still recorded; nothing is sent. |
| `BACKUP_DIR` | a `backups` folder beside `DB_PATH` | Where Admin's file copies and the `backup` command write. |
| `BACKUP_KEEP_DAYS` | `30` | How long a file copy is kept before the next copy prunes it. |
| `RESTORE_CONFIRM` | unset | Set to `yes` on the next boot to apply a restore staged from Admin. Without it the pending file is left in place and the live database is untouched. |
| `ERROR_SALT` | — **(required)** | Mixed into the hash of an address before it is stored — an error report, a sign-in attempt, a session, the audit trail — so an address cannot be recovered from its hash. **There is no default**: `change-me`, `replace-with-a-secret` and `kanbantoolkit` are values this project publishes. A Node instance running with `NODE_ENV=production` — which the image sets, and which [install.md](install.md) puts in the unit file — **refuses to start** when this is unset or is a published placeholder, and the log line names the variable. A development run still starts with a random salt for the process, so nothing published is used. Changing the value later does not corrupt anything: the hashes already recorded stop matching, a loss of rate-limit continuity and not of a record. |
| `PROJECT_URL` | unset | Where this project's own site is, if the instance should link its terms and privacy pages. Set, the sign-in surface links them; unset, it says whose policies apply with no link. Never this instance's own address. |
| `API_RATE_LIMIT` | `120` | Requests a minute one token may make against `/api/v1`. The window is per token and kept in memory, so a restart grants a fresh one and a runaway loop gets a `429`. |

**Making the salt.** `openssl rand -hex 32` prints one. Put it where the process reads its other
secrets — the `.env` a Compose install loads, the unit file a bare machine runs, `wrangler secret put`
on Cloudflare — and not in a file that is committed. Generate it once, on the machine that keeps it. A
Worker has no start to refuse: on Cloudflare an isolate with no salt generates its own, and the
per-hour report limit then only counts within that isolate; the secret is what makes one number hold
across them.

## The doors

The identity provider is **the one you already run**. No vendor is built in and there is no endpoint
list to keep current: any OIDC issuer works — Google Workspace, Entra, Keycloak, authentik, Okta —
because they all speak the same protocol.

Every provider is optional, and an instance with none is valid: the doors that do not need one are
still there. A **password** works wherever an account has one — the first administrator sets one at
first run, an invitation is where a colleague chooses theirs — and a **magic link** appears when a mail
relay is configured. With neither a provider nor a relay, an instance is still reachable by password
and by the reset link an administrator mints.

| Variable | Default | What it does |
| --- | --- | --- |
| `AUTH_OIDC_CLIENT_ID`, `AUTH_OIDC_CLIENT_SECRET` | — | Your issuer's client credentials. Both are required; either one alone leaves the door closed. |
| `AUTH_OIDC_AUTHORIZE_ENDPOINT`, `AUTH_OIDC_TOKEN_ENDPOINT`, `AUTH_OIDC_USERINFO_ENDPOINT` | — | Where that issuer lives. All three are required and used as given. |
| `AUTH_OIDC_LABEL` | the issuer's host | What the button says. |
| `AUTH_OIDC_SCOPE` | `openid email profile` | What Kanban Toolkit asks for: an address and a name. |
| `AUTH_DEV` | off | `AUTH_DEV=1` turns on a development identity: sign in with an address, no provider, no password. **Never set it on an instance anybody can reach** — it is a door with no lock. |

## Provisioning

SCIM is not configured by environment: an administrator mints its token in **Admin → Directory
provisioning**, named, with the workspace role a provisioned person gets. The endpoints, the lifecycle
and the boundary (a group carries no authority by itself) are in [Identity](identity.md). One instance
may have several tokens, so two directories can be told apart and one revoked without the other.

## Mail

Mail is a capability of the runtime, like the live channel. The Node entry can speak SMTP to a relay. A
deployment without one still runs, without a magic link; an administrator hands over a reset link
instead.

| Variable | Default | What it does |
| --- | --- | --- |
| `SMTP_URL` | — | The relay: `smtp://user:pass@host:587`, or `smtps://` for implicit TLS on 465. STARTTLS is required for anything that is not a relay on this machine. |
| `MAIL_FROM` | — | The envelope sender, and the `From:` a person sees. Both this and `SMTP_URL` are needed; either alone means no mail. |
| `MAIL_CONSOLE` | off | `MAIL_CONSOLE=1` writes each message to the log instead of sending it — development, and the test suite, which must not open a socket to a mail server. |
| `MAIL_DIGEST` | on | `MAIL_DIGEST=0` turns off the watched-work digest for a relay used only for sign-in links. The digest is only offered when a relay exists. |

A relay on `127.0.0.1`, `::1` or `localhost` may be plain SMTP, which is how a self-hoster usually
runs postfix beside the app. Anything else must offer STARTTLS; a server that does not is refused
rather than spoken to in the clear.

When a relay exists, people may turn on **Email me about the work I watch** in their profile, and
choose *as it happens*, *daily* or *weekly*. One plain-text message per person per period is computed
at send time from the outbox and the board: what changed on the work they watch, what was assigned
to them, where they were mentioned, what is due this week, and the watched initiatives that went at
risk. It carries a tokenized unsubscribe link and a preferences link; nothing in it fetches a remote
resource, so opening it tells nobody. `PUBLIC_URL` is what makes those links absolute — without it
the message still sends, with a line telling the reader to open their instance.

The Worker has no mail: it cannot open an SMTP connection, so on Cloudflare the magic-link door is
absent and the identity provider is the way in.

The redirect URI to register with a provider is `PUBLIC_URL` + `/api/auth/callback`. Register the
https address, not the http one: the provider checks it, and a mismatch is the most common reason a
sign-in fails.

## Build-time only

These are read by `npm run build`, not by the server, and end up in the files it writes.

| Variable | Default | What it does |
| --- | --- | --- |
| `SITE_URL` | `https://kanbantoolkit.example` | The canonical origin: every page's `<link rel="canonical">`, the Open Graph URLs and `sitemap.xml`. Set it to the real address or search engines will index the placeholder. |
| `REPO_URL` | `https://github.com/malcolmbastien/kanbantoolkit` | Where the source, the licence and these docs live. The site's Docs, Source and Licence links are built from it. |
| `SUPPORT_URL` | the repository's issue form | Where the footer's “Questions & bugs” points, with the response expectation beside it — and where `security.txt`, the security page and the privacy notice send a security report too. A self-hoster points it at their own. |

## Cloudflare

A Worker reads bindings rather than variables it can invent. `wrangler.jsonc` declares:

| Binding | What it is |
| --- | --- |
| `ASSETS` | the built client in `dist/` |
| `DB` | the D1 database — uncomment the `d1_databases` block and put the id `wrangler d1 create` prints |
| `WORKSPACE_CHANNEL` | the Durable Object that holds the live sockets, one per workspace |

Without `DB` the API answers `503` and says the database is not configured, and no sign-in surface is
drawn. That is how the project's own hosted site runs: the Worker serves the site and the demo, and
nothing else. Uncommenting the `DB` block turns the deployment into an instance. Read
[Passwords on Workers](server-runtime.md#passwords-on-workers-cost-more-cpu-than-the-free-plan-gives)
first, because the free plan's CPU budget cannot cover a password check. Without the
`WORKSPACE_CHANNEL` binding, clients poll for changes.

## Checking what an instance actually offers

```bash
curl -s https://kanbantoolkit.example/api/auth/providers
# {"providers":[{"id":"oidc","label":"login.example.com"}],"dev":false}
```

That is what the sign-in surface reads: a provider missing from the list is missing because both of its
credentials were not set.

---

**Last verified:** 0.1.0, against `server/config.ts` and `wrangler.jsonc`: every variable in this
table read back from the code that uses it.
