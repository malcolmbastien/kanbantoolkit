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

function settings(env: unknown): Settings {
  return (env ?? {}) as Settings
}

function value(env: unknown, key: string): string | undefined {
  const raw = settings(env)[key]
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined
}

/** Mixed into the stored address hash, so the table holds a hash rather than a person's address. */
export function salt(env: unknown): string {
  return value(env, 'ERROR_SALT') ?? 'flowline'
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
 * The providers this code knows by name — the hosted defaults.
 *
 * Exported because the privacy notice names them, and a notice that drifts from the code is worse
 * than no notice: `server/site.test.ts` fails when a provider here is not listed in
 * `site/processors.json`.
 */
export const KNOWN = {
  google: {
    label: 'Google',
    authorizeEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    userinfoEndpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
  },
  microsoft: {
    label: 'Microsoft',
    authorizeEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userinfoEndpoint: 'https://graph.microsoft.com/oidc/userinfo',
    scope: 'openid email profile',
  },
} as const

/**
 * The providers this instance offers.
 *
 * Google and Microsoft are the hosted defaults, and are enabled by their client credentials rather
 * than by a code change. A self-hoster with an identity provider of its own sets `AUTH_OIDC_*` and
 * gets a third door — the same flow, its own issuer — without touching this file.
 *
 * A provider with no client id or secret is simply absent, so an instance with none configured is a
 * valid instance: it is the static tier, with no accounts at all.
 */
export function providers(env: unknown): Provider[] {
  const list: Provider[] = []

  for (const id of ['google', 'microsoft'] as const) {
    const clientId = value(env, `AUTH_${id.toUpperCase()}_CLIENT_ID`)
    const clientSecret = value(env, `AUTH_${id.toUpperCase()}_CLIENT_SECRET`)
    if (!clientId || !clientSecret) continue
    const known = KNOWN[id]
    const tenant = id === 'microsoft' ? (value(env, 'AUTH_MICROSOFT_TENANT') ?? 'common') : ''
    list.push({
      id,
      label: known.label,
      authorizeEndpoint: known.authorizeEndpoint.replace('/common/', `/${tenant}/`),
      tokenEndpoint: known.tokenEndpoint.replace('/common/', `/${tenant}/`),
      userinfoEndpoint: known.userinfoEndpoint,
      clientId,
      clientSecret,
      scope: known.scope,
    })
  }

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
      label: value(env, 'AUTH_OIDC_LABEL') ?? 'your provider',
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
