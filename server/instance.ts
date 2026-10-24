/**
 * The instance's posture: who may come in.
 *
 * Closed by default, and the answer is read on every sign-in rather than cached, because the moment
 * it matters is the moment an administrator opens or closes it.
 */

import type { Database, Statement } from './db'

export type Access = 'open' | 'closed'

const ROW = 'instance'

/** The posture, or `closed` when the question cannot be answered — the safe failure. */
export async function accessMode(db: Database): Promise<Access> {
  try {
    const row = await db.get<{ access: string }>('SELECT access FROM instance_settings WHERE id = ?1', [ROW])
    return row?.access === 'open' ? 'open' : 'closed'
  } catch {
    // An unmigrated database is not an open one.
    return 'closed'
  }
}

/** A domain, lowercased, that looks like a domain and nothing else. */
export function normaliseDomain(value: string): string | undefined {
  const domain = value.trim().toLowerCase().replace(/^\.+|\.+$/g, '')
  // No scheme, no path, no wildcard: a suffix match is how "notexample.com" gets in.
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain) ? domain : undefined
}

export interface Settings {
  access: Access
  allowedDomains: string[]
}

/** The posture and the domains it admits, read whole. */
export async function settings(db: Database): Promise<Settings> {
  try {
    const row = await db.get<{ access: string; allowed_domains: string | null }>(
      'SELECT access, allowed_domains FROM instance_settings WHERE id = ?1',
      [ROW],
    )
    let allowedDomains: string[] = []
    try {
      const parsed: unknown = JSON.parse(row?.allowed_domains ?? '[]')
      if (Array.isArray(parsed)) allowedDomains = parsed.filter((entry): entry is string => typeof entry === 'string')
    } catch {
      allowedDomains = []
    }
    return { access: row?.access === 'open' ? 'open' : 'closed', allowedDomains }
  } catch {
    return { access: 'closed', allowedDomains: [] }
  }
}

/** Whether a verified address's domain is one the instance admits without an invitation. */
export function admitsDomain(input: Settings, email: string): boolean {
  const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase()
  // Exact, not suffix: "notexample.com" must never match "example.com".
  return domain.length > 0 && input.allowedDomains.includes(domain)
}

export async function setAccess(db: Database, access: Access, audit?: Statement): Promise<void> {
  const change = {
    sql: `INSERT INTO instance_settings (id, access, updated_at) VALUES (?1, ?2, ?3)
          ON CONFLICT (id) DO UPDATE SET access = excluded.access, updated_at = excluded.updated_at`,
    params: [ROW, access, new Date().toISOString()],
  }
  await db.batch(audit ? [change, audit] : [change])
}

export async function setAllowedDomains(db: Database, allowedDomains: string[], audit?: Statement): Promise<void> {
  const change = {
    sql: `INSERT INTO instance_settings (id, allowed_domains, updated_at) VALUES (?1, ?2, ?3)
          ON CONFLICT (id) DO UPDATE SET allowed_domains = excluded.allowed_domains, updated_at = excluded.updated_at`,
    params: [ROW, JSON.stringify(allowedDomains), new Date().toISOString()],
  }
  await db.batch(audit ? [change, audit] : [change])
}
