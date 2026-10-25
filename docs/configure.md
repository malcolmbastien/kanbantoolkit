# Configure

Everything Flowline reads is an environment variable, and every one of them has a default that
works. Set nothing and you get a running board with no way in — which is a valid instance, and the
static tier is exactly that.

Two rules hold everywhere:

- **A variable that is unset is absent, not empty.** `AUTH_GOOGLE_CLIENT_ID=""` and no variable at
  all are the same thing, and neither draws a button that cannot work.
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

## The doors

Every provider is optional, and an instance with none is a valid instance — it simply has no way in,
and the app says so rather than drawing a button.

| Variable | Default | What it does |
| --- | --- | --- |
| `AUTH_GOOGLE_CLIENT_ID`, `AUTH_GOOGLE_CLIENT_SECRET` | — | Google Sign-In. Both are required; either one alone leaves Google absent. Never the only way in by design: an instance that wants it pairs it with another provider or an invitation. |
| `AUTH_MICROSOFT_CLIENT_ID`, `AUTH_MICROSOFT_CLIENT_SECRET` | — | Microsoft. The client id and secret are what enable it. |
| `AUTH_MICROSOFT_TENANT` | `common` | The tenant the endpoints are built from: `common` for any work account, a tenant id for one organisation. |
| `AUTH_OIDC_CLIENT_ID`, `AUTH_OIDC_CLIENT_SECRET` | — | An identity provider of your own. The same flow, your issuer. |
| `AUTH_OIDC_AUTHORIZE_ENDPOINT`, `AUTH_OIDC_TOKEN_ENDPOINT`, `AUTH_OIDC_USERINFO_ENDPOINT` | — | Where that provider lives. All three are required, and all three are used as given. |
| `AUTH_OIDC_LABEL` | `your provider` | What the button says. |
| `AUTH_OIDC_SCOPE` | `openid email profile` | What Flowline asks for. It needs an address and a name, and nothing more. |
| `AUTH_DEV` | off | `AUTH_DEV=1` turns on a development identity: sign in with an address, no provider, no password. **Never set it on an instance anybody can reach** — it is a door with no lock. |

**There is no mail relay**, and nothing to configure for one. Invitations are links an administrator
makes and sends however they like; the server never writes to an address. That is a decision, not a
missing feature: a self-hosted instance with no SMTP is a valid instance, and a shared secret is one
fewer thing to leak.

The redirect URI to register with a provider is `PUBLIC_URL` + `/api/auth/callback`. Register the
https address, not the http one: the provider checks it, and a mismatch is the most common reason a
sign-in fails.

## Build-time only

These are read by `npm run build`, not by the server. They end up in the files it writes.

| Variable | Default | What it does |
| --- | --- | --- |
| `SITE_URL` | `https://flowline.example` | The canonical origin: every page's `<link rel="canonical">`, the Open Graph URLs and `sitemap.xml`. Set it to the real address or search engines will index the placeholder. |
| `REPO_URL` | `https://github.com/flowline/flowline` | Where the source, the licence and these docs live. The site's Docs, Source and Licence links are built from it. |

## Cloudflare

A Worker reads bindings rather than variables it can invent. `wrangler.jsonc` declares:

| Binding | What it is |
| --- | --- |
| `ASSETS` | the built client in `dist/` |
| `DB` | the D1 database — uncomment the `d1_databases` block and put the id `wrangler d1 create` prints |
| `WORKSPACE_CHANNEL` | the Durable Object that holds the live sockets, one per workspace |

Without `DB` the API answers `503` and says the database is not configured. Without
`WORKSPACE_CHANNEL`, clients poll — nothing else changes.

## Checking what an instance actually offers

```bash
curl -s https://flowline.example/api/auth/providers
# {"providers":[{"id":"microsoft","label":"Microsoft"}],"dev":false}
```

That is the truth the sign-in surface reads. A provider missing from that list is missing because its
credentials were not both present — not because a page forgot to draw the button.

---

**Last verified:** 0.1.0, against `server/config.ts` and `wrangler.jsonc`: every variable in this
table read back from the code that uses it.
