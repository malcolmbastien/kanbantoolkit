#!/usr/bin/env node
/**
 * kanbantoolkit — the small CLI (task 148, R7).
 *
 * It exists for one job: to get a machine credential into the hands of a tool without either an
 * administrator minting one by hand or the secret passing through a clipboard, a shell history or a
 * chat message. `kanbantoolkit login` asks the instance for a short code, prints it, and waits. The person
 * approves in the browser they are already signed in to; the secret arrives here, once, and is written
 * with mode 0600 (or into the file `KANBANTOOLKIT_TOKEN_FILE` names).
 *
 * No dependencies, because a credential helper that has to be installed before it can be trusted is a
 * credential helper nobody runs. Node 20 or later — it uses the fetch the runtime already has.
 *
 *   npx kanbantoolkit login --url http://localhost:8787
 *   kanbantoolkit whoami
 *   kanbantoolkit token        # prints it, for a script that would rather pipe than read a file
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const DEFAULT_SCOPES = ['boards:read', 'items:read']

const help = `kanbantoolkit — connect a tool to this instance

  kanbantoolkit login [--url URL] [--name NAME] [--scopes a,b] [--days N] [--token-file PATH]
      Ask the instance for a code, wait for a person to approve it, and store the credential.

  kanbantoolkit whoami [--url URL] [--token-file PATH]
      Ask the instance who the stored credential is.

  kanbantoolkit token [--token-file PATH]
      Print the stored credential, for a command substitution.

Options:
  --url          This instance. Defaults to $KANBANTOOLKIT_URL, then http://localhost:8787.
  --name         What the tool is called in the person's list. Default: "kanbantoolkit on <hostname>".
  --scopes       Comma-separated: ${DEFAULT_SCOPES.join(', ')} (default), boards:write, items:write,
                 items:comment, objectives:write, people:read, workspace:admin, instance:admin.
  --days         How long the credential lasts, in whole days, or "never". Default: the instance's (90).
  --token-file   Where to store it. Default: $KANBANTOOLKIT_TOKEN_FILE, then $XDG_CONFIG_HOME/kanbantoolkit/token,
                 then ~/.config/kanbantoolkit/token.
`

function parse(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      args._.push(arg)
      continue
    }
    const [flag, inline] = arg.slice(2).split('=', 2)
    args[flag] = inline ?? argv[++i] ?? ''
  }
  return args
}

const tokenPath = (args) =>
  resolve(args['token-file'] ?? process.env.KANBANTOOLKIT_TOKEN_FILE ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'kanbantoolkit', 'token'))

const baseUrl = (args) => (args.url ?? process.env.KANBANTOOLKIT_URL ?? 'http://localhost:8787').replace(/\/+$/, '')

function store(path, secret) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${secret}\n`, { encoding: 'utf8', mode: 0o600 })
  // `mode` on create is a promise the platform may not keep; the chmod is the one that holds when the
  // file already existed with different permissions.
  chmodSync(path, 0o600)
}

function readStored(path, args) {
  const explicit = args['token-file'] ?? process.env.KANBANTOOLKIT_TOKEN_FILE
  if (!existsSync(path)) {
    console.error(`No credential at ${path}. Run "kanbantoolkit login --url ${baseUrl(args)}" first.`)
    process.exit(2)
  }
  return readFileSync(path, 'utf8').trim()
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function login(args) {
  const url = baseUrl(args)
  const name = args.name ?? `kanbantoolkit on ${process.env.HOSTNAME ?? 'this machine'}`
  const scopes = (args.scopes ?? DEFAULT_SCOPES.join(','))
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean)
  const days = args.days === undefined ? undefined : args.days === 'never' ? null : Number(args.days)

  const asked = await fetch(`${url}/api/tokens/device`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, scopes, ...(days === undefined ? {} : { expiresInDays: days }) }),
  }).then((response) => response.json().catch(() => ({})))

  if (!asked.user_code) {
    console.error(`The instance refused the request: ${asked.error ?? 'no reason given'}`)
    process.exit(1)
  }

  console.log('')
  console.log(`  To connect "${name}", open:`)
  console.log('')
  console.log(`    ${asked.verification_uri}`)
  console.log('')
  console.log(`  and check that it shows the code ${asked.user_code}.`)
  console.log('  Waiting…')
  console.log('')

  const interval = Math.max(1, asked.interval ?? 2) * 1000
  const deadline = Date.now() + (asked.expires_in ?? 600) * 1000
  while (Date.now() < deadline) {
    await delay(interval)
    const answer = await fetch(`${url}/api/tokens/device/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_code: asked.device_code }),
    })
    if (answer.status === 200) {
      const { secret } = await answer.json()
      const path = tokenPath(args)
      store(path, secret)
      console.log(`  Connected. The credential is at ${path} (mode 0600).`)
      console.log('')
      console.log(`    curl -H "Authorization: Bearer $(kanbantoolkit token)" ${url}/api/workspace`)
      console.log('')
      return
    }
    if (answer.status === 428) continue
    const body = await answer.json().catch(() => ({}))
    console.error(`  Not connected: ${body.error ?? 'the code is no longer valid'}.`)
    process.exit(1)
  }

  console.error('  The code expired before it was approved. Run "kanbantoolkit login" again.')
  process.exit(1)
}

async function whoami(args) {
  const url = baseUrl(args)
  const secret = readStored(tokenPath(args), args)
  const answer = await fetch(`${url}/api/me`, { headers: { authorization: `Bearer ${secret}` } })
  if (!answer.ok) {
    console.error(`That credential is not valid here (${answer.status}).`)
    process.exit(1)
  }
  const who = await answer.json()
  console.log(`${who.name ?? 'someone'} <${who.email ?? 'no address'}> — ${who.instanceRole ?? 'member'}`)

  // What this credential may reach is its scopes; what it may actually do is their intersection with
  // the person's role, which the server decides per request.
  const self = await fetch(`${url}/api/tokens/self`, { headers: { authorization: `Bearer ${secret}` } })
  if (self.ok) {
    const { credential } = await self.json().catch(() => ({}))
    if (credential) console.log(`  scopes: ${credential.scopes.join(', ') || 'none — it can do nothing'}`)
  }
}

const args = parse(process.argv.slice(2))
const command = args._[0] ?? (args.help ? 'help' : '')

if (command === 'login') await login(args)
else if (command === 'whoami') await whoami(args)
else if (command === 'token') process.stdout.write(`${readStored(tokenPath(args), args)}\n`)
else if (command === 'help' || command === '--help' || command === '-h') console.log(help)
else {
  console.log(help)
  process.exit(command ? 1 : 0)
}
