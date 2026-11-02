/**
 * Configuration, read the same way wherever it arrives.
 *
 * On Cloudflare this is the binding object; on a self-hosted machine it is `process.env`. Neither
 * shape is read directly by a route, so a self-hoster configures a provider list with environment
 * variables and nothing else — which is the whole point of R2 in task 117.
 */

export interface Provider {
  id: string
  label: string
  authorizeEndpoint: string
  tokenEndpoint: string
  userinfoEndpoint: string
  clientId: string
  clientSecret: string
  scope: string
}

type Settings = Record<string, string | undefined>

/** The host of a URL, for naming an issuer nobody gave a label to. */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return 'your identity provider'
  }
}

function settings(env: unknown): Settings {
  return (env ?? {}) as Settings
}

function value(env: unknown, key: string): string | undefined {
  const raw = settings(env)[key]
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined
}

/**
 * Whether this process is a served instance rather than a development run.
 *
 * The image sets `NODE_ENV=production` (the Dockerfile, and therefore Compose), and a self-hosted
 * unit sets it too — docs/install.md shows the line. It is deliberately the only signal: treating
 * anything that is not `development` as production would make `npm run server` refuse on a laptop.
 */
export function isProduction(env: unknown): boolean {
  return (value(env, 'NODE_ENV') ?? '').toLowerCase() === 'production'
}

/**
 * Values this project publishes: the default Compose used to ship, the fallback this file used to
 * carry, and the string the install guide once asked an operator to paste. None of them is a secret,
 * and an address hash keyed with one has its key in the repository — the table remembers a hash and
 * anyone can compute the same hash for an address they suspect.
 */
const PUBLISHED_SALTS = new Set(['change-me', 'kanbantoolkit', 'replace-with-a-secret'])

/** A configured salt worth using, or nothing. A published placeholder is not a secret. */
function usableSalt(env: unknown): string | undefined {
  const configured = value(env, 'ERROR_SALT')
  if (!configured) return undefined
  return PUBLISHED_SALTS.has(configured.toLowerCase()) ? undefined : configured
}

/**
 * What is wrong with the salt, or nothing.
 *
 * `server/index.node.ts` asks before it opens the database, so a misconfigured instance stops with
 * one clear line rather than collecting reports it cannot keep anonymous. A development run is told
 * too, and starts anyway (see `salt`).
 */
export function saltProblem(env: unknown): string | undefined {
  if (usableSalt(env)) return undefined
  const configured = value(env, 'ERROR_SALT')
  return configured
    ? `ERROR_SALT is "${configured}", a value this project publishes as a placeholder. Set it to a secret`
    : 'ERROR_SALT is not set. Set it to a secret (docs/configure.md)'
}

/** The salt this process made for itself, when the operator did not give it one. */
let generatedSalt: string | undefined

/**
 * Mixed into the stored address hash, so the table holds a hash rather than a person's address.
 *
 * A configured secret is used as given. Anything else — unset, blank, or one of the placeholders this
 * project publishes — is refused by an instance, so no published value can become a deployment's key
 * unnoticed. A development run still starts: it gets a random salt for the process, which means the
 * worst case is that a restart detaches yesterday's rate-limit counts from today's.
 */
export function salt(env: unknown): string {
  const configured = usableSalt(env)
  if (configured) return configured
  if (isProduction(env)) {
    const problem = saltProblem(env)
    if (problem) throw new Error(problem)
  }
  generatedSalt ??= randomSalt()
  return generatedSalt
}

/** Thirty-two random bytes, in hex: unguessable, and short enough to sit in an environment line. */
function randomSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Where this instance is, as the outside world sees it. A redirect URI has to match what was
 * registered with the provider, and behind a proxy the request's own origin is not that address.
 */
export function publicUrl(env: unknown, request: Request): string {
  const configured = value(env, 'PUBLIC_URL')
  if (configured) return configured.replace(/\/+$/, '')
  return new URL(request.url).origin
}

/**
 * Whether this instance is served over https *as configured*, rather than as the request happened
 * to arrive. Behind a proxy the request is http and the browser is not, and the cookie has to be
 * issued for the browser.
 */
export function httpsConfigured(env: unknown): boolean {
  return (value(env, 'PUBLIC_URL') ?? '').toLowerCase().startsWith('https:')
}

/**
 * The development identity switch. It is off unless it is asked for by name, so an instance that
 * is merely running locally is not an instance anyone can walk into.
 */
export function devAuth(env: unknown): boolean {
  return value(env, 'AUTH_DEV') === '1'
}

/**
 * The provider this instance offers: the operator's own OIDC issuer.
 *
 * There is no vendor in this file, and that is the point. A team that runs Kanban Toolkit already has an
 * identity provider — Google Workspace, Entra, Keycloak, authentik — and each of them speaks OIDC.
 * Naming two of them here would have meant a third and a fourth later, a table of endpoints to keep
 * current, and a deployment that cannot use the provider it actually has.
 *
 * A provider with no client id or secret is simply absent, so an instance with none configured is a
 * valid instance: the board still runs, and the sign-in surface says in words that it has no way in
 * rather than drawing a button that cannot work. (Task 154 adds the password and magic-link doors
 * beside this one.)
 */
export function providers(env: unknown): Provider[] {
  const list: Provider[] = []

  const oidc = {
    clientId: value(env, 'AUTH_OIDC_CLIENT_ID'),
    clientSecret: value(env, 'AUTH_OIDC_CLIENT_SECRET'),
    authorizeEndpoint: value(env, 'AUTH_OIDC_AUTHORIZE_ENDPOINT'),
    tokenEndpoint: value(env, 'AUTH_OIDC_TOKEN_ENDPOINT'),
    userinfoEndpoint: value(env, 'AUTH_OIDC_USERINFO_ENDPOINT'),
  }
  if (oidc.clientId && oidc.clientSecret && oidc.authorizeEndpoint && oidc.tokenEndpoint && oidc.userinfoEndpoint) {
    list.push({
      id: 'oidc',
      // The operator's own words, or the issuer's host: "login.example.com" says more than
      // "your provider" when somebody has two of them open.
      label: value(env, 'AUTH_OIDC_LABEL') ?? hostOf(oidc.authorizeEndpoint),
      authorizeEndpoint: oidc.authorizeEndpoint,
      tokenEndpoint: oidc.tokenEndpoint,
      userinfoEndpoint: oidc.userinfoEndpoint,
      clientId: oidc.clientId,
      clientSecret: oidc.clientSecret,
      scope: value(env, 'AUTH_OIDC_SCOPE') ?? 'openid email profile',
    })
  }

  return list
}

/**
 * The name a workspace is created with, when the installation does not choose one.
 *
 * One instance is one team (task 163), so the name belongs to the installation rather than to a
 * person filling in a form: `WORKSPACE_NAME` is set once, beside the port and the database path.
 */
export const DEFAULT_WORKSPACE_NAME = 'Kanban Toolkit'

/**
 * Where this project's own site is, for the two pages the app links to.
 *
 * The terms and the privacy notice on an instance are the **project's**, not the operator's: they
 * describe the software and this project's site, and both say so. So the sign-in surface links them
 * only when the deployment knows where they live — `PROJECT_URL` — and says whose policies apply
 * without a link when it does not. A link to a domain nobody serves is worse than a sentence.
 */
export function projectUrl(env: unknown): string | undefined {
  const configured = value(env, 'PROJECT_URL')
  if (!configured) return undefined
  try {
    const url = new URL(configured)
    return url.protocol === 'https:' || url.protocol === 'http:' ? configured.replace(/\/+$/, '') : undefined
  } catch {
    return undefined
  }
}

/** What this deployment calls the team it is for. */
export function workspaceName(env: unknown): string {
  return (value(env, 'WORKSPACE_NAME') ?? DEFAULT_WORKSPACE_NAME).slice(0, 120)
}
