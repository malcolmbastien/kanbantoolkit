/**
 * MCP over stdio — the bridge an agent spawns (task 170).
 *
 * An agent that runs locally starts this process, talks JSON-RPC on stdin and reads it on stdout,
 * and this forwards each message to the instance's `/mcp` with the token. It is a bridge rather
 * than a second server: the tools, the rules and the trail are the instance's, so a local agent and
 * a remote one are the same caller with the same limits. Nothing is decided here, and nothing is
 * cached — a revocation is felt on the next message.
 *
 *   FLOWLINE_URL=https://board.example.com FLOWLINE_TOKEN=flt_… npx tsx server/mcp.ts
 *
 * The token may also come from the file `flowline login` writes (`FLOWLINE_TOKEN_FILE`, or the
 * default `~/.config/flowline/token`), which is how the CLI already stores it. Stdout is the
 * protocol channel and carries nothing else; anything a person should read goes to stderr.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

/** What a message costs on the wire: a body in, a status and a body out. */
export type Poster = (body: string) => Promise<{ status: number; text: string }>

/**
 * One line in, one line out — or nothing, for a notification.
 *
 * A notification (any message without an `id`) is answered `202` with no body, and a client that
 * gets a line back for one would be confused by a response to something it never asked.
 */
export async function bridgeLine(line: string, post: Poster): Promise<string | null> {
  const trimmed = line.trim()
  if (!trimmed) return null
  const answer = await post(trimmed)
  if (answer.status === 202 || !answer.text.trim()) return null
  return answer.text.trim()
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

/** The stored credential: the same file `flowline login` writes, with the same default. */
function storedToken(): string | undefined {
  const path = argument('token-file') ?? process.env.FLOWLINE_TOKEN_FILE ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'flowline', 'token')
  try {
    return readFileSync(path, 'utf8').trim() || undefined
  } catch {
    return undefined
  }
}

export async function main(): Promise<void> {
  const url = (argument('url') ?? process.env.FLOWLINE_URL ?? 'http://localhost:8787').replace(/\/+$/, '')
  const token = argument('token') ?? process.env.FLOWLINE_TOKEN ?? storedToken()

  if (!token) {
    console.error(
      `No credential. Run "flowline login --url ${url}" once, or set FLOWLINE_TOKEN. This bridge speaks MCP on stdin/stdout and needs a token to act as somebody.`,
    )
    process.exit(2)
  }

  const post: Poster = async (body) => {
    try {
      const answer = await fetch(`${url}/mcp`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
        body,
      })
      return { status: answer.status, text: await answer.text() }
    } catch (error) {
      console.error(`Flowline is unreachable at ${url}: ${error instanceof Error ? error.message : String(error)}`)
      return { status: 503, text: '' }
    }
  }

  console.error(`Flowline MCP bridge: ${url}`)
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of lines) {
    const answer = await bridgeLine(line, post)
    if (answer) process.stdout.write(`${answer}\n`)
  }
}

// Only when run as a program: imported by a test, this module is a function, not a process.
const invokedDirectly = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url
if (invokedDirectly) void main()
