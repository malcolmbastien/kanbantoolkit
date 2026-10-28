/**
 * A workspace this build cannot read, kept rather than replaced.
 *
 * Browser storage is the only copy there is, so the worst response to an unreadable workspace is
 * to seed the demo over it: the person's boards would be gone, and the demo would look like their
 * work. Instead the slice is moved aside **byte for byte**, under its own key, and the app says
 * what happened and offers the file.
 *
 * Nothing here reads or writes the store: it runs before the store exists.
 */

/** The key the workspace itself lives under. */
export const WORKSPACE_KEY = 'kanbantoolkit-state-v3'
/** Where an unreadable one is kept. A second copy gets `.2`, a third `.3`, and so on. */
export const KEPT_PREFIX = `${WORKSPACE_KEY}.unreadable`

export interface KeptWorkspace {
  /** The key the copy lives under. */
  key: string
  /** The version the stored text claimed, or `null` when it claimed nothing readable. */
  found: number | null
  /** The stored text, untouched. */
  raw: string
}

function parse(raw: string): { state?: unknown; version?: unknown } | null {
  try {
    const value: unknown = JSON.parse(raw)
    return value && typeof value === 'object' ? (value as { state?: unknown; version?: unknown }) : null
  } catch {
    return null
  }
}

/** Whether this build can place what the stored text says it is. */
function readable(raw: string, build: number, minKnown: number): boolean {
  const parsed = parse(raw)
  if (!parsed) return false
  if (!parsed.state || typeof parsed.state !== 'object' || Array.isArray(parsed.state)) return false
  const version = parsed.version
  return typeof version === 'number' && Number.isFinite(version) && version >= minKnown && version <= build
}

function isKept(key: string): boolean {
  return key === KEPT_PREFIX || key.startsWith(`${KEPT_PREFIX}.`)
}

/** The first free kept key: `.unreadable`, then `.2`, `.3`, … */
function nextKey(): string {
  let key = KEPT_PREFIX
  for (let n = 2; localStorage.getItem(key) !== null; n += 1) key = `${KEPT_PREFIX}.${n}`
  return key
}

/**
 * Read what the browser holds **before** the store asks for it, and move anything this build
 * cannot read out of the way. Answers the copy it made, or `null` when there was nothing to do.
 *
 * A copy that cannot itself be stored leaves the workspace where it is: deleting what could not be
 * saved would be the one outcome worse than refusing to load it.
 */
export function quarantineUnreadable(opts: { build: number; minKnown: number }): KeptWorkspace | null {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(WORKSPACE_KEY)
  } catch {
    return null
  }
  if (raw === null || readable(raw, opts.build, opts.minKnown)) return null

  const parsed = parse(raw)
  const found = typeof parsed?.version === 'number' ? parsed.version : null
  const kept: KeptWorkspace = { key: nextKey(), found, raw }
  try {
    localStorage.setItem(kept.key, raw)
    localStorage.removeItem(WORKSPACE_KEY)
  } catch {
    return null
  }
  return kept
}

/** Every kept copy this browser holds. */
export function keptWorkspaces(): KeptWorkspace[] {
  const keys: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key && isKept(key)) keys.push(key)
    }
  } catch {
    return []
  }
  return keys.flatMap((key) => {
    let raw: string | null = null
    try {
      raw = localStorage.getItem(key)
    } catch {
      return []
    }
    if (raw === null) return []
    const parsed = parse(raw)
    const found = typeof parsed?.version === 'number' ? parsed.version : null
    return [{ key, found, raw }]
  })
}

/** The copy to show: the newest one, which is the one with the highest suffix. */
export function keptWorkspace(): KeptWorkspace | null {
  const suffix = (key: string) => (key === KEPT_PREFIX ? 1 : Number(key.slice(KEPT_PREFIX.length + 1)) || 1)
  return [...keptWorkspaces()].sort((a, b) => suffix(b.key) - suffix(a.key))[0] ?? null
}

/** Remove a kept copy — only after the person says they have it. */
export function forgetKeptWorkspace(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // Nothing to do: the copy stays, which is the safe side of this.
  }
}

/**
 * The file offered for a kept copy: the export's shape, so a build that can read that version
 * takes it straight back through Import. The stored copy itself is never reshaped.
 */
export function keptWorkspaceFile(kept: KeptWorkspace): { filename: string; text: string } {
  const parsed = parse(kept.raw)
  const state = parsed && 'state' in parsed ? parsed.state : parsed
  return {
    filename: `kanbantoolkit-kept-${new Date().toISOString().slice(0, 10)}.json`,
    text: JSON.stringify(
      { app: 'kanbantoolkit', exportedAt: new Date().toISOString(), version: kept.found ?? 0, state },
      null,
      2,
    ),
  }
}
