import { describe, expect, it } from 'vitest'
import { consoleMailer } from './mail'

/**
 * The contract, and the transport development uses: no socket, no server, one line in the log.
 */
describe('the console mailer', () => {
  it('offers a console transport for development, which sends nothing', async () => {
    const lines: string[] = []
    await consoleMailer((line) => lines.push(line)).send({ to: 'grace@example.com', subject: 'Your link', text: 'Here' })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('grace@example.com')
    expect(lines[0]).toContain('Here')
  })
})
