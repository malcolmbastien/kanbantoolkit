/**
 * What the application asks of the machine it is running on.
 *
 * Two things genuinely differ between the hosted instance and a self-hosted one: where the database
 * is, and which header carries the client's address. Everything else — configuration, the provider
 * list, the salt — arrives as `env`, which is a set of bindings on Cloudflare and `process.env` on a
 * machine. Keeping this list short is what keeps `server/` portable.
 */

import type { Database } from './db'

export interface Runtime {
  /** The database for this request, or undefined when the deployment has none configured. */
  database(env: unknown): Database | undefined
  /** The address that made the request, as the runtime sees it. */
  clientIp(request: Request): string
}
