/**
 * A limit per credential, in memory (tasks 169, 170 and 168 share it).
 *
 * In memory because the limit is a guard against a runaway loop rather than an accounting system:
 * losing a window on restart costs a client one minute of extra allowance, and a table written on
 * every request would cost every client a write. A Cloudflare deployment keeps this per isolate,
 * which the docs say rather than hide — the real limit there is the scope on the token.
 */

const WINDOW_MS = 60_000

interface Window {
  startedAt: number
  count: number
}

const windows = new Map<string, Window>()

/** Spend one request against a key's minute. The answer carries what a header needs. */
export function spend(key: string, limit: number): { allowed: boolean; remaining: number; reset: number } {
  const now = Date.now()
  const current = windows.get(key)
  const window = !current || now - current.startedAt >= WINDOW_MS ? { startedAt: now, count: 0 } : current
  window.count += 1
  windows.set(key, window)
  // A map that grows forever is a leak; expired windows are the only ones worth dropping.
  if (windows.size > 5_000) {
    for (const [id, value] of windows) if (now - value.startedAt >= WINDOW_MS) windows.delete(id)
  }
  return {
    allowed: window.count <= limit,
    remaining: Math.max(0, limit - window.count),
    reset: Math.max(0, Math.ceil((window.startedAt + WINDOW_MS - now) / 1000)),
  }
}

/** The limit is configuration (`docs/configure.md`); the default is generous for a script or a sync. */
export function limitPerMinute(env: unknown): number {
  const raw = (env as Record<string, unknown> | undefined)?.API_RATE_LIMIT
  const value = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 120
}
