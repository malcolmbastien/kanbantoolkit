/**
 * The SMTP client — the Node entry's half of the mail capability.
 *
 * The small part of the protocol that sending needs: greeting, EHLO, STARTTLS when offered, AUTH
 * PLAIN when credentials are in the URL, one message, quit. Here rather than in a dependency because
 * the two runtimes share one `package.json`, and a mail library is a large tree for one `DATA`
 * command.
 *
 * **TLS is required**, with one exception: a relay on this machine (a local postfix beside the app),
 * which is how a self-hoster usually runs it. A server that does not offer STARTTLS anywhere else is
 * refused rather than spoken to in the clear.
 */

import { connect as netConnect } from 'node:net'
import type { Socket } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import type { Message, Mail } from './mail'

const TIMEOUT_MS = 15_000

/** One SMTP conversation, over a socket that may still be upgraded to TLS. */
class Session {
  private buffer = ''
  private watcher: ((line: string) => void) | undefined
  private waiters: Array<(code: number) => void> = []
  private failure: ((error: Error) => void)[] = []

  private socket: Socket | null

  constructor(socket: Socket | null) {
    this.socket = socket
    this.listen(socket)
  }

  private listen(socket: Socket | null) {
    if (!socket) return
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      this.buffer += chunk
      // A reply is one or more `NNN-` continuation lines and one `NNN ` final line.
      let index: number
      while ((index = this.buffer.search(/\r?\n/)) !== -1) {
        const line = this.buffer.slice(0, index)
        this.buffer = this.buffer.slice(index + (this.buffer[index] === '\r' ? 2 : 1))
        this.watcher?.(line)
        if (/^\d{3} /.test(line)) {
          const waiter = this.waiters.shift()
          if (waiter) waiter(Number(line.slice(0, 3)))
        }
      }
    })
    const failed = (error: Error) => {
      const waiting = this.failure.shift()
      if (waiting) waiting(error)
    }
    socket.on('error', failed)
    socket.on('close', () => failed(new Error('the mail server closed the connection')))
  }

  /** Watch every line of the next reply, or stop watching when given nothing. */
  observe(watcher: ((line: string) => void) | undefined) {
    this.watcher = watcher
  }

  /** Replace the socket after STARTTLS, keeping the conversation going on the new one. */
  upgrade(socket: Socket) {
    this.socket?.removeAllListeners('data')
    this.buffer = ''
    this.socket = socket
    this.listen(socket)
  }

  read(): Promise<number> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the mail server did not answer in time')), TIMEOUT_MS)
      this.waiters.push((code) => {
        clearTimeout(timer)
        resolve(code)
      })
      this.failure.push((error) => {
        clearTimeout(timer)
        reject(error)
      })
    })
  }

  async command(line: string, expect: number | number[] = 250): Promise<number> {
    this.socket?.write(`${line}\r\n`)
    const code = await this.read()
    const wanted = Array.isArray(expect) ? expect : [expect]
    if (!wanted.includes(code)) throw new Error(`the mail server said ${code} to "${line.split(' ')[0]}"`)
    return code
  }

  async write(data: string): Promise<void> {
    this.socket?.write(data)
  }

  close(): void {
    this.socket?.end()
  }
}

/** A relay beside the app: 127.0.0.1, ::1, or the name for them. */
function loopback(host: string): boolean {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost'
}

function isIp(host: string): boolean {
  return /^\d+(\.\d+){3}$/.test(host) || host.includes(':')
}

/**
 * Say EHLO and hand back the capabilities the server listed.
 *
 * A capability list is the multiline reply: `250-STARTTLS`, `250-AUTH PLAIN`, `250 SIZE …`. The
 * session's reader already waits for the final line; this records what came before it.
 */
async function greet(session: Session, host: string): Promise<string[]> {
  const capabilities: string[] = []
  session.observe((line) => {
    if (line.startsWith('250')) capabilities.push(line.slice(4).toUpperCase())
  })
  await session.command(`EHLO ${host}`)
  session.observe(undefined)
  return capabilities
}

function parseUrl(value: string): { host: string; port: number; secure: boolean; user?: string; password?: string } {
  const url = new URL(value)
  const secure = url.protocol === 'smtps:' || url.port === '465'
  return {
    host: url.hostname,
    port: Number(url.port || (secure ? 465 : 587)),
    secure,
    ...(url.username ? { user: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
  }
}

/** A socket that is a TLS stream from the first byte, or a plain one that STARTTLS may upgrade. */
function open(options: { host: string; port: number; secure: boolean }): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = options.secure
      ? tlsConnect({ host: options.host, port: options.port, servername: options.host }, () => resolve(socket))
      : netConnect({ host: options.host, port: options.port }, () => resolve(socket))
    socket.setTimeout(TIMEOUT_MS, () => {
      socket.destroy()
      reject(new Error('the mail server did not answer in time'))
    })
    socket.once('error', reject)
  })
}

/**
 * The SMTP mailer, or `undefined` when there is no relay to speak to.
 *
 * `SMTP_URL` is the whole configuration — `smtp://user:pass@host:587`, `smtps://` for implicit TLS —
 * and `MAIL_FROM` is the envelope sender. Without both there is no mailer, and the caller offers no
 * door that would need one.
 */
export function smtpMailer(env: NodeJS.ProcessEnv): Mail | undefined {
  const configured = env.SMTP_URL
  const from = env.MAIL_FROM
  if (!configured || !from) return undefined

  return {
    async send(message: Message) {
      const options = parseUrl(configured)
      const session = new Session(await open(options))
      try {
        await session.read() // 220 greeting
        const host = options.host
        const offered = await greet(session, host)

        if (!options.secure) {
          // TLS is required, with one exception: a relay on this machine, which is how a self-hoster
          // runs postfix beside the app. Anything else must offer STARTTLS, and a server that does
          // not is refused rather than spoken to in the clear.
          if (!offered.includes('STARTTLS') && !loopback(host)) {
            throw new Error('the mail server does not offer STARTTLS, so the message was not sent')
          }
          if (offered.includes('STARTTLS')) {
            await session.command('STARTTLS', 220)
            const secured = tlsConnect({
              socket: (session as unknown as { socket: Socket }).socket,
              ...(isIp(host) ? {} : { servername: host }),
            })
            await new Promise<void>((resolve, reject) => {
              secured.once('secureConnect', () => resolve())
              secured.once('error', reject)
            })
            session.upgrade(secured)
            await greet(session, host)
          }
        }

        if (options.user) {
          // AUTH PLAIN: an empty authorisation identity, then the user and the password, one base64.
          const secret = Buffer.from(`\u0000${options.user}\u0000${options.password ?? ''}`).toString('base64')
          await session.command(`AUTH PLAIN ${secret}`, 235)
        }

        await session.command(`MAIL FROM:<${from}>`)
        await session.command(`RCPT TO:<${message.to}>`, [250, 251])
        await session.command('DATA', 354)

        const headers = [
          `From: ${from}`,
          `To: ${message.to}`,
          `Subject: ${message.subject.replace(/[\r\n]+/g, ' ')}`,
          `Date: ${new Date().toUTCString()}`,
          'MIME-Version: 1.0',
          'Content-Type: text/plain; charset=utf-8',
          'Content-Transfer-Encoding: 8bit',
        ]
        // Dot-stuffing: a line that begins with "." would end the message early.
        const body = message.text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..')
        await session.write(`${headers.join('\r\n')}\r\n\r\n${body}\r\n.\r\n`)
        await session.command('', 250)
        await session.command('QUIT', [221, 250])
      } finally {
        session.close()
      }
    },
  }
}

