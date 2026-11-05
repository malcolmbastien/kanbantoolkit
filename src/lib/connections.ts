/**
 * Which boards this browser is showing its connections for.
 *
 * A connections view is a reading of one board, so it is remembered here rather than in the
 * workspace: it is not a fact about the work, and a second person opening the same board should
 * decide for themselves. Keeping it out of the persisted workspace slice is deliberate — an
 * exported or imported workspace carries the work, not this browser's lens.
 */

const KEY = 'kanbantoolkit-connections-v1'

/** The per-board switches this browser remembers. A missing board is off. */
export function readBoardConnections(): Record<string, boolean> {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const switches: Record<string, boolean> = {}
    for (const [id, on] of Object.entries(parsed as Record<string, unknown>)) {
      if (id.length > 0 && on === true) switches[id] = true
    }
    return switches
  } catch {
    // A preference that cannot be read is not a reason to fail the board; every board simply
    // opens with the view off.
    return {}
  }
}

/** Persist the switches. A full disk or a private window is a lost preference, not an error. */
export function writeBoardConnections(switches: Record<string, boolean>): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(KEY, JSON.stringify(switches))
  } catch {
    // The toggle still works for this session.
  }
}
