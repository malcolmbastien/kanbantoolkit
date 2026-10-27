# Configure

Everything Flowline reads is an environment variable, and every one of them has a default that
works. Set nothing and you get a running board with no way in — which is a valid instance, and the
static tier is exactly that.

Two rules hold everywhere:

- **A variable that is unset is absent, not empty.** `AUTH_OIDC_CLIENT_ID=""` and no variable at all
  are the same thing, and neither draws a button that cannot work.
- **Secrets live in the environment**, not in this file, not in the database, and not in `dist/`
  (which is build output and can be rebuilt by anybody with the repository).

## Where the values come from

| Runtime | How it reads them |
| --- | --- |
| **Node** (self-hosted) | `process.env` — a systemd unit, a `.env` your process manager loads, or the shell |
| **Cloudflare** | Worker bindings and `vars` in `wrangler.jsonc`; secrets with `wrangler secret put` |

The application never reads either directly. `server/config.ts` is the only file that knows a binding
from an environment, which is what lets one set of routes run on both.

## The core

| Variable | Default | What it does, and what happens when it is unset |
| --- | --- | --- |
| `PORT` | `8787` | The port the Node entry listens on. Unset is the default; a proxy forwards to it. |
| `DB_PATH` | `./flowline.db` | The SQLite file. Unset puts it beside the working directory. The file **is** the instance. |
| `STATIC_DIR` | `./dist` | Where the built site and app are. Unset assumes `dist/` under the working directory. |
| `WORKSPACE_NAME` | `Flowline` | What the installation calls the team. Applied when the workspace is created, and re-applied only to the name the row was created with — never over a name a person chose. |
| `PUBLIC_URL` | the request's own origin | The address the outside world uses. It is what a sign-in redirect URI is built from, and `https` in it is what decides the session cookie's `Secure` attribute. Behind a proxy, set it. |
| `LIVE` | on | Set to `0` to switch the live channel off. The app then polls the same feed, which is what it does on any host without a socket server. |
| `ERROR_SALT` | `flowline` | Mixed into the hash of a reporter's address before it is stored. Set it to a secret in production: the salt is what stops an address being recovered from a hash. |
| `PROJECT_URL` | unset | Where this project's own site is, if the instance should link its terms and privacy pages. Set, the sign-in surface links them; unset, it says whose policies apply with no link. Never this instance's own address. |
| `API_RATE_LIMIT` | `120` | Requests a minute one token may make against `/api/v1`. Generous for a script and low enough that a runaway loop is a `429` rather than an outage. The window is per token and kept in memory, so a restart grants a fresh one — it is a guard, not an accounting system. |

## The doors

The identity provider is **the one you already run**. There is no vendor built into the product and no
list of endpoints to keep current: any OIDC issuer works — Google Workspace, Entra, Keycloak,
authentik, Okta — because they all speak the same protocol.

Every provider is optional, and an instance with none is a valid instance: the doors that do not need
one are still there. A **password** works wherever an account has one — the first administrator sets
one at first run, an invitation is where a colleague chooses theirs — and a **magic link** appears
when a mail relay is configured. With neither a provider nor a relay, an instance is still reachable
by password and by the reset link an administrator mints.

| Variable | Default | What it does |
| --- | --- | --- |
| `AUTH_OIDC_CLIENT_ID`, `AUTH_OIDC_CLIENT_SECRET` | — | Your issuer's client credentials. Both are required; either one alone leaves the door closed. |
| `AUTH_OIDC_AUTHORIZE_ENDPOINT`, `AUTH_OIDC_TOKEN_ENDPOINT`, `AUTH_OIDC_USERINFO_ENDPOINT` | — | Where that issuer lives. All three are required, and all three are used as given. |
| `AUTH_OIDC_LABEL` | the issuer's host | What the button says. `login.example.com` is a better label than "your provider" when a person has two of them open. |
| `AUTH_OIDC_SCOPE` | `openid email profile` | What Flowline asks for. It needs an address and a name, and nothing more. |
| `AUTH_DEV` | off | `AUTH_DEV=1` turns on a development identity: sign in with an address, no provider, no password. **Never set it on an instance anybody can reach** — it is a door with no lock. |

## Provisioning

SCIM is not configured by environment: an instance administrator mints its token in **Admin →
Directory provisioning**, named, with the workspace role a provisioned person gets. The endpoints, the
lifecycle and the boundary (a group carries no authority by itself) are in
[Identity](identity.md). One instance may have several tokens, so two directories can be told apart
and one revoked without the other.

## Mail

Mail is a **capability of the runtime**, like the live channel: the Node entry can speak SMTP to a
relay, and a deployment without one still runs — it simply does not offer a magic link (task 154.7),
and an administrator hands over a reset link instead.

| Variable | Default | What it does |
| --- | --- | --- |
| `SMTP_URL` | — | The relay: `smtp://user:pass@host:587`, or `smtps://` for implicit TLS on 465. STARTTLS is required for anything that is not a relay on this machine. |
| `MAIL_FROM` | — | The envelope sender, and the `From:` a person sees. Both this and `SMTP_URL` are needed; either alone means no mail. |
| `MAIL_CONSOLE` | off | `MAIL_CONSOLE=1` writes each message to the log instead of sending it — development, and the test suite, which must not open a socket to somebody's mail server. |

A relay on `127.0.0.1`, `::1` or `localhost` may be plain SMTP, which is how a self-hoster usually
runs postfix beside the app. Anything else must offer STARTTLS; a server that does not is refused
rather than spoken to in the clear.

The Worker has no mail: it cannot open an SMTP connection, so on Cloudflare the magic-link door is
absent and the identity provider is the way in.

The redirect URI to register with a provider is `PUBLIC_URL` + `/api/auth/callback`. Register the
https address, not the http one: the provider checks it, and a mismatch is the most common reason a
sign-in fails.

## Build-time only

These are read by `npm run build`, not by the server. They end up in the files it writes.

| Variable | Default | What it does |
| --- | --- | --- |
| `SITE_URL` | `https://flowline.example` | The canonical origin: every page's `<link rel="canonical">`, the Open Graph URLs and `sitemap.xml`. Set it to the real address or search engines will index the placeholder. |
| `REPO_URL` | `https://github.com/malcolmbastien/flowline` | Where the source, the licence and these docs live. The site's Docs, Source and Licence links are built from it. |
| `SUPPORT_URL` | the repository's issue form | Where the footer's “Questions & bugs” points, with the response expectation beside it. A self-hoster points it at their own tracker. |
| `SECURITY_URL` | the repository's private advisory form | The link in `security.txt`, on the security page, and in the privacy notice. `https://` only: this project publishes no mailbox for anybody to answer. |

## Cloudflare

A Worker reads bindings rather than variables it can invent. `wrangler.jsonc` declares:

| Binding | What it is |
| --- | --- |
| `ASSETS` | the built client in `dist/` |
| `DB` | the D1 database — uncomment the `d1_databases` block and put the id `wrangler d1 create` prints |
| `WORKSPACE_CHANNEL` | the Durable Object that holds the live sockets, one per workspace |

Without `DB` the API answers `503` and says the database is not configured, and no sign-in surface is
drawn: that is the state the project's own deployment is in, where the Worker serves the site and the
demo and nothing else. Uncommenting it makes the deployment an instance — read
[Passwords on Workers](server-runtime.md#passwords-on-workers-cost-more-cpu-than-the-free-plan-gives)
first, because the free plan's CPU budget cannot cover a password check. Without `WORKSPACE_CHANNEL`,
clients poll — nothing else changes.

## Checking what an instance actually offers

```bash
curl -s https://flowline.example/api/auth/providers
# {"providers":[{"id":"oidc","label":"login.example.com"}],"dev":false}
```

That is the truth the sign-in surface reads. A provider missing from that list is missing because its
credentials were not both present — not because a page forgot to draw the button.

---

**Last verified:** 0.1.0, against `server/config.ts` and `wrangler.jsonc`: every variable in this
table read back from the code that uses it.
