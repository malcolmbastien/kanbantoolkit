/**
 * There is no vendor in the code.
 *
 * Task 154.1 removed the google and microsoft endpoint tables: an instance's identity provider is the
 * operator's own OIDC issuer, whoever runs it. That is a decision, and a decision written only in a
 * commit message is a decision that comes back — so this file reads the source and fails when a
 * provider table or its credentials reappear.
 *
 * It checks the *mechanism*, not the word: naming an issuer as an example in a comment ("Workspace,
 * Entra, Keycloak") is documentation, while an endpoint table and an `AUTH_Google_...` variable are
 * a product decision. The endpoints are what this test looks for.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = new URL('..', import.meta.url).pathname
const DIRECTORIES = ['src', 'server', 'site', 'docs']

/** Every text file under a directory, as { path, text }. */
function sources(directory: string): Array<{ path: string; text: string }> {
  const found: Array<{ path: string; text: string }> = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) {
        if (name === 'node_modules' || name === '.git') continue
        walk(path)
      } else if (/\.(ts|tsx|mjs|js|json|html|md|css)$/.test(name)) {
        found.push({ path: path.slice(ROOT.length), text: readFileSync(path, 'utf8') })
      }
    }
  }
  walk(join(ROOT, directory))
  return found
}

// Every file but this one: a test that names what it forbids would otherwise find itself.
const files = DIRECTORIES.flatMap(sources).filter((file) => !file.path.endsWith('server/providers.test.ts'))

describe('no vendor is a provider', () => {
  it('has no vendor endpoint table anywhere', () => {
    // The four endpoints that made Google and Microsoft providers rather than examples.
    for (const endpoint of ['accounts.google.com', 'oauth2.googleapis.com', 'login.microsoftonline.com', 'graph.microsoft.com']) {
      const offenders = files.filter((file) => file.text.includes(endpoint)).map((file) => file.path)
      expect(offenders, `${endpoint} is still in the code`).toEqual([])
    }
  })

  it('reads no vendor credentials', () => {
    for (const variable of ['AUTH_GOOGLE_CLIENT_ID', 'AUTH_GOOGLE_CLIENT_SECRET', 'AUTH_MICROSOFT_CLIENT_ID', 'AUTH_MICROSOFT_CLIENT_SECRET', 'AUTH_MICROSOFT_TENANT']) {
      const offenders = files.filter((file) => file.text.includes(variable)).map((file) => file.path)
      expect(offenders, `${variable} is still read`).toEqual([])
    }
  })

  it('keeps the provider list built from the operator’s own issuer', () => {
    const config = readFileSync(join(ROOT, 'server/config.ts'), 'utf8')
    expect(config).not.toContain('export const KNOWN')
    expect(config).toContain('AUTH_OIDC_CLIENT_ID')
    // The list is one issuer, so the endpoint the operator gave is used as given.
    expect(config).toContain('authorizeEndpoint: oidc.authorizeEndpoint')
  })
})
