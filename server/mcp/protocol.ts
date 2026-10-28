/**
 * MCP, as far as a tools server needs it (task 170).
 *
 * The Model Context Protocol is JSON-RPC 2.0 with a small vocabulary: `initialize`, a notification
 * that the client is ready, `tools/list`, `tools/call`, and `ping`. There is no dependency here and
 * none is wanted — a credential-bearing server that a team installs should not pull a second
 * protocol stack to answer four methods — and the shapes below are the ones in the specification.
 *
 * Two rules from the task, encoded rather than commented:
 *
 * - **a refusal is a tool result, not a crash** (R7): the operation's own sentence goes back with
 *   `isError: true`, so the agent can tell a person why instead of retrying a bare failure;
 * - **a read-only token has no write tools at all** (R5): the list is filtered by scope, so the agent
 *   is never shown a door it would be refused at.
 */

import { can } from '../../src/domain/roles'
import { grants } from '../../src/domain/scopes'
import type { OpCaller } from '../operations'
import { TOOLS } from './tools'

/** The revision of the protocol this server speaks. Clients negotiate by echoing it. */
export const PROTOCOL_VERSION = '2025-06-18'
export const SERVER_INFO = { name: 'kanbantoolkit', version: '1.0.0' }

export interface RpcMessage {
  jsonrpc?: unknown
  id?: string | number | null
  method?: unknown
  params?: unknown
}

export interface RpcAnswer {
  /** 202 for a notification (no body), 200 for a result or a JSON-RPC error. */
  status: number
  body?: unknown
}

const result = (id: RpcMessage['id'], value: unknown): RpcAnswer => ({ status: 200, body: { jsonrpc: '2.0', id: id ?? null, result: value } })

const error = (id: RpcMessage['id'], code: number, message: string, data?: unknown): RpcAnswer => ({
  status: 200,
  body: { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } },
})

const toolText = (text: string) => [{ type: 'text', text }]

/**
 * One message in, one answer out.
 *
 * A notification (a message with no `id`) is answered with 202 and nothing else, which is what the
 * transport layer needs to know; everything else is a JSON-RPC response, including the refusals a
 * tool made — those are *results*, because a tool that refuses is a tool that worked.
 */
export async function handleRpc(caller: OpCaller, message: unknown): Promise<RpcAnswer> {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return { status: 400, body: { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'a single JSON-RPC message is required' } } }
  }

  const request = message as RpcMessage
  if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    return { status: 400, body: { jsonrpc: '2.0', id: request.id ?? null, error: { code: -32600, message: 'not a JSON-RPC 2.0 request' } } }
  }

  const notification = request.id === undefined || request.id === null
  if (notification) {
    // `notifications/initialized` is the only one a tools server receives, and it needs no answer.
    return { status: 202 }
  }

  switch (request.method) {
    case 'initialize':
      return result(request.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          'Kanban Toolkit is a board of cards and initiatives. Read `workspace_summary` or `list_boards` first; every write needs ids from `get_board`. Refusals come back as tool results with the reason, and nothing is ever applied twice or half-way.',
      })

    case 'ping':
      return result(request.id, {})

    case 'tools/list':
      return result(request.id, {
        tools: TOOLS.filter((tool) => grants(caller.scopes, tool.scope)).map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      })

    case 'tools/call': {
      const params = (request.params ?? {}) as { name?: unknown; arguments?: unknown }
      const name = typeof params.name === 'string' ? params.name : ''
      const args = params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
        ? (params.arguments as Record<string, unknown>)
        : {}

      const tool = TOOLS.find((candidate) => candidate.name === name)
      if (!tool) return error(request.id, -32601, `no tool named “${name}”`)
      // A tool the credential has no scope for is not in its list; calling it anyway is the same
      // "no such tool" from this credential's point of view, and saying so leaks nothing.
      if (!grants(caller.scopes, tool.scope)) {
        return error(request.id, -32601, `no tool named “${name}” for this credential (it needs the ${tool.scope} scope)`)
      }
      if (tool.action && !can(caller.role, tool.action)) {
        return result(request.id, {
          content: toolText(`a ${caller.role} may not ${tool.action}`),
          structuredContent: { error: 'role_forbidden', role: caller.role, action: tool.action },
          isError: true,
        })
      }

      const answer = await tool.run(caller, args)
      if (!answer.ok) {
        // The operation's sentence, whole. A refusal is a result: the agent's next turn can explain
        // it to a person rather than guess what a 500 meant.
        return result(request.id, {
          content: toolText(answer.error.message),
          structuredContent: { error: answer.error.code, ...(answer.error.details ? { details: answer.error.details } : {}) },
          isError: true,
        })
      }
      return result(request.id, {
        content: toolText(JSON.stringify(answer.value)),
        structuredContent: answer.value as Record<string, unknown>,
      })
    }

    default:
      return error(request.id, -32601, `no method named “${request.method}”`)
  }
}
