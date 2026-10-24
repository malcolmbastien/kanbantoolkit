/**
 * The workspace's live channel, as a Durable Object.
 *
 * Cloudflare runs a request in whichever isolate is nearest, and two isolates cannot see each
 * other's memory — so "tell everybody who is listening" needs one object that every writer and
 * every listener can reach. That is what this is: one instance per workspace, holding the sockets,
 * and a `publish` that rings them.
 *
 * What it carries is a nudge — `{"revision": n}` — and never a change. The client reads the feed it
 * already knows how to read, so a change has one shape whichever transport delivered the news, and
 * a socket that is lost is simply a client that polls until it is back.
 *
 * The sockets are *hibernatable*: the object can be evicted between messages and the connections
 * survive, which is the difference between a channel that costs nothing while idle and one that
 * bills for a heartbeat.
 */

import { DurableObject } from 'cloudflare:workers'

export class WorkspaceChannel extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // A writer saying "the feed moved". Answered, never awaited by the caller for anything but
    // the acknowledgement.
    if (url.pathname === '/publish') {
      const body = (await request.json().catch(() => null)) as { revision?: unknown } | null
      const revision = typeof body?.revision === 'number' ? body.revision : 0
      this.broadcast(revision)
      return new Response(null, { status: 204 })
    }

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('this channel speaks websocket', { status: 426 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    // Hibernation: the connection outlives the isolate that accepted it.
    this.ctx.acceptWebSocket(server)
    return new Response(null, { status: 101, webSocket: client })
  }

  /** Nothing is expected from a listener: the channel is one-way, and the feed is the other way. */
  webSocketMessage(): void {}

  /** A socket that has gone is not an error to report; it is a tab that closed. */
  webSocketClose(): void {}

  private broadcast(revision: number): void {
    const message = JSON.stringify({ revision })
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message)
      } catch {
        // A socket that has gone is dropped by the runtime.
      }
    }
  }
}
