import { createServer } from 'node:net'
import type { Server, Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { smtpMailer } from './mail-smtp'

/**
 * The SMTP client, against a server that speaks the protocol.
 *
 * The stub is deliberately literal — greeting, a multiline EHLO, AUTH PLAIN, one DATA — because the
 * point of a hand-written client is that it says exactly the right words in the right order, and only
 * a transcript can prove that.
 */

interface Conversation {
  lines: string[]
  data: string
}

/** A plain-text SMTP server on a port the operating system picks. */
function stub(options: { advertiseStartTls?: boolean } = {}): Promise<{ port: number; conversation: Conversation; close: () => Promise<void> }> {
  const conversation: Conversation = { lines: [], data: '' }
  const sockets = new Set<Socket>()
  const server: Server = createServer((socket: Socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.setEncoding('utf8')
    let buffer = ''
    let inData = false
    const say = (line: string) => socket.write(`${line}\r\n`)
    say('220 stub.example ESMTP')

    socket.on('data', (chunk: string) => {
      buffer += chunk
      let index: number
      while ((index = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)

        if (inData) {
          if (line === '.') {
            inData = false
            conversation.data = conversation.data.replace(/\r\n$/, '')
            say('250 queued')
          } else {
            conversation.data += `${line}\r\n`
          }
          continue
        }

        conversation.lines.push(line)
        const verb = line.split(' ')[0].toUpperCase()
        if (verb === 'EHLO') {
          say('250-stub.example')
          if (options.advertiseStartTls) say('250-STARTTLS')
          say('250-AUTH PLAIN')
          say('250 SIZE 1024000')
        } else if (verb === 'STARTTLS') {
          // Answer, then hang up: the client will start a handshake on a socket that is gone, so it
          // fails at once instead of waiting for a timeout. The assertion is that it asked for TLS
          // and refused to go on without it — not that the handshake completed.
          say('220 go ahead')
          socket.destroy()
        } else if (verb === 'AUTH') {
          say('235 authenticated')
        } else if (verb === 'MAIL' || verb === 'RCPT') {
          say('250 ok')
        } else if (verb === 'DATA') {
          inData = true
          say('354 send it')
        } else if (verb === 'QUIT') {
          say('221 bye')
          socket.end()
        } else {
          say('250 ok')
        }
      }
    })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        port,
        conversation,
        close: () =>
          new Promise<void>((done) => {
            for (const socket of sockets) socket.destroy()
            server.close(() => done())
          }),
      })
    })
  })
}

let open: { close: () => Promise<void> } | undefined
afterEach(async () => {
  await open?.close()
  open = undefined
})

describe('the SMTP mailer', () => {
  it('sends one plain-text message, in the order the protocol asks for', async () => {
    const stubServer = await stub()
    open = stubServer
    const mail = smtpMailer({
      SMTP_URL: `smtp://ada:s3cret@127.0.0.1:${stubServer.port}`,
      MAIL_FROM: 'kanbantoolkit@example.com',
    })
    expect(mail).toBeTruthy()

    await mail!.send({ to: 'grace@example.com', subject: 'Your link', text: 'Here it is: https://kanbantoolkit.example/app' })

    const verbs = stubServer.conversation.lines.map((line) => line.split(' ')[0].toUpperCase())
    expect(verbs[0]).toBe('EHLO')
    expect(verbs).toContain('AUTH')
    expect(verbs).toContain('MAIL')
    expect(verbs).toContain('RCPT')
    expect(verbs).toContain('DATA')
    expect(verbs).toContain('QUIT')

    expect(stubServer.conversation.lines.find((line) => line.startsWith('AUTH PLAIN '))).toBe(
      `AUTH PLAIN ${Buffer.from('\u0000ada\u0000s3cret').toString('base64')}`,
    )
    expect(stubServer.conversation.lines).toContain('MAIL FROM:<kanbantoolkit@example.com>')
    expect(stubServer.conversation.lines).toContain('RCPT TO:<grace@example.com>')

    // Plain text, the headers that matter, and the body untouched.
    expect(stubServer.conversation.data).toContain('To: grace@example.com')
    expect(stubServer.conversation.data).toContain('Subject: Your link')
    expect(stubServer.conversation.data).toContain('Content-Type: text/plain; charset=utf-8')
    expect(stubServer.conversation.data).toContain('Here it is: https://kanbantoolkit.example/app')
  })

  it('dot-stuffs a body that begins with a dot, so nothing ends the message early', async () => {
    const stubServer = await stub()
    open = stubServer
    const mail = smtpMailer({ SMTP_URL: `smtp://127.0.0.1:${stubServer.port}`, MAIL_FROM: 'kanbantoolkit@example.com' })

    await mail!.send({ to: 'grace@example.com', subject: 'S', text: '.hidden\n.\nnot a dot' })

    expect(stubServer.conversation.data).toContain('\r\n..hidden\r\n..\r\nnot a dot')
  })

  it('asks for STARTTLS when the server offers it', async () => {
    const stubServer = await stub({ advertiseStartTls: true })
    open = stubServer
    const mail = smtpMailer({ SMTP_URL: `smtp://127.0.0.1:${stubServer.port}`, MAIL_FROM: 'kanbantoolkit@example.com' })

    // The stub answers the upgrade with a plain socket, so the handshake fails — which is the point:
    // the client asked for TLS and refused to continue without it.
    await expect(mail!.send({ to: 'grace@example.com', subject: 'S', text: 'T' })).rejects.toThrow()
    expect(stubServer.conversation.lines.map((line) => line.split(' ')[0].toUpperCase())).toContain('STARTTLS')
  })

  it('does not exist without a relay and a sender', () => {
    expect(smtpMailer({})).toBeUndefined()
    expect(smtpMailer({ SMTP_URL: 'smtp://127.0.0.1:25' })).toBeUndefined()
    expect(smtpMailer({ MAIL_FROM: 'kanbantoolkit@example.com' })).toBeUndefined()
  })
})
