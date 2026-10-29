/**
 * The instance's posture: who may come in.
 *
 * There is one answer, and it is **closed**: every person needs an account, and an account arrives
 * by invitation, by an administrator re-opening a deleted workspace, or from a domain the
 * administrator listed. There is no open sign-up, and nothing here reads a stored posture — a
 * database that still carries the retired `access` column cannot open the door.
 *
 * A listed domain is still a door, so it is read on every sign-in rather than cached: the moment it
 * matters is the moment an administrator changes it.
 */

import type { Database, Statement } from './db'

const ROW = 'instance'

/** A domain, lowercased, that looks like a domain and nothing else. */
export function normaliseDomain(value: string): string | undefined {
  const domain = value.trim().toLowerCase().replace(/^\.+|\.+$/g, '')
  // No scheme, no path, no wildcard: a suffix match is how "notexample.com" gets in.
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain) ? domain : undefined
}

export interface Settings {
  allowedDomains: string[]
}

/** The domains the instance admits without an invitation, read whole. */
export async function settings(db: Database): Promise<Settings> {
  try {
    const row = await db.get<{ allowed_domains: string | null }>(
      'SELECT allowed_domains FROM instance_settings WHERE id = ?1',
      [ROW],
    )
    let allowedDomains: string[] = []
    try {
      const parsed: unknown = JSON.parse(row?.allowed_domains ?? '[]')
      if (Array.isArray(parsed)) allowedDomains = parsed.filter((entry): entry is string => typeof entry === 'string')
    } catch {
      allowedDomains = []
    }
    return { allowedDomains }
  } catch {
    return { allowedDomains: [] }
  }
}

/** Whether a verified address's domain is one the instance admits without an invitation. */
export function admitsDomain(input: Settings, email: string): boolean {
  const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase()
  // Exact, not suffix: "notexample.com" must never match "example.com".
  return domain.length > 0 && input.allowedDomains.includes(domain)
}

export async function setAllowedDomains(db: Database, allowedDomains: string[], audit?: Statement): Promise<void> {
  const change = {
    sql: `INSERT INTO instance_settings (id, allowed_domains, updated_at) VALUES (?1, ?2, ?3)
          ON CONFLICT (id) DO UPDATE SET allowed_domains = excluded.allowed_domains, updated_at = excluded.updated_at`,
    params: [ROW, JSON.stringify(allowedDomains), new Date().toISOString()],
  }
  await db.batch(audit ? [change, audit] : [change])
}
