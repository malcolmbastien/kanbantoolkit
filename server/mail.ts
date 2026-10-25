/**
 * Sending the two messages this product sends.
 *
 * A **capability of the runtime**, like the live channel: the Node entry speaks SMTP to whatever
 * relay the operator configured (`server/mail-smtp.ts`), the Worker has none, and a deployment with
 * none simply does not offer a magic link (task 154.7). The alternative — a route that calls an SDK —
 * would have put a vendor's client library in the portable core and a `503` in the middle of a form.
 *
 * Plain text only. No images, no tracking pixel, no link shortener: a message that renders the same
 * in every client cannot tell anybody whether it was opened, and this product does not want to know.
 *
 * This file is the *contract*: what a message is, and the console transport development uses. The
 * SMTP client lives beside it in `mail-smtp.ts`, because it needs `node:net` and this directory is
 * compiled for the Worker as well — the boundary the portable core is held to.
 */

export interface Message {
  to: string
  subject: string
  text: string
}

/** What the runtime can do: send one plain-text message, or not be there at all. */
export interface Mail {
  send(message: Message): Promise<void>
}

/** A transport that writes the message to the log — development, and the test suite. */
export function consoleMailer(write: (line: string) => void = console.log): Mail {
  return {
    async send(message) {
      write(`mail to ${message.to} — ${message.subject}\n${message.text}`)
    },
  }
}
