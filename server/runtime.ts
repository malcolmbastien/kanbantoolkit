/**
 * What the application asks of the machine it is running on.
 *
 * Two things genuinely differ between the hosted instance and a self-hosted one: where the database
 * is, and which header carries the client's address. Everything else — configuration, the provider
 * list, the salt — arrives as `env`, which is a set of bindings on Cloudflare and `process.env` on a
 * machine. Keeping this list short is what keeps `server/` portable.
 */

import type { Database } from './db'
import type { Mail } from './mail'

export interface Runtime {
  /** The database for this request, or undefined when the deployment has none configured. */
  database(env: unknown): Database | undefined
  /** The address that made the request, as the runtime sees it. */
  clientIp(request: Request): string
  /**
   * The live channel, when this deployment has one. A Worker answers with a Durable Object, the
   * Node entry with its own WebSocket server, and a deployment with neither leaves this out — the
   * client then polls the same feed, and nothing else in the application changes.
   */
  live?: {
    /** Ring the bell: the workspace's feed has moved. Never says what moved. */
    publish(env: unknown, workspaceId: string, revision: number): Promise<void> | void
  }
  /**
   * Mail, when this deployment has a relay to send it through.
   *
   * The same shape as `live`: the Node entry speaks SMTP to whatever the operator configured, the
   * Worker has none, and a deployment without one simply does not offer a magic link (task 154.7).
   * A route asks whether it is there; it never asks which runtime it is on.
   */
  mail?: Mail
  /**
   * The version this build is, when the runtime can say.
   *
   * An operator running three containers needs to tell them apart; `/api/health` is where they look,
   * and "which build is this" is a question a deployment answers better than a person remembers.
   */
  version?: string
}
