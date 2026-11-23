import { describe, expect, it, vi } from 'vitest'
import type { Database } from './db'
import { JOBS, jobEnabled, runJob, type Job, type JobContext } from './jobs'

const db = {} as Database
const ctx = (env: Record<string, string> = {}): JobContext => ({ db, env })

describe('the shared periodic jobs', () => {
  it('installs every job unless the deployment or the runtime switches it off', () => {
    const names = JOBS.map((job) => job.name)
    expect(names).toEqual(['webhook dispatch', 'change feed prune', 'audit prune', 'error log prune', 'mail digest'])

    const webhooks = JOBS.find((job) => job.name === 'webhook dispatch')!
    expect(jobEnabled(webhooks, ctx())).toBe(true)
    expect(jobEnabled(webhooks, ctx({ WEBHOOKS: '0' }))).toBe(false)

    const digest = JOBS.find((job) => job.name === 'mail digest')!
    expect(jobEnabled(digest, ctx())).toBe(false)
    expect(jobEnabled(digest, { ...ctx({ MAIL_DIGEST: '0' }), mail: {} as never })).toBe(false)
  })

  it('skips a disabled job and keeps a failure out of the tick', async () => {
    const skipped = vi.fn(async () => undefined)
    const disabled: Job = { name: 'disabled', everyMs: 1, enabled: () => false, run: skipped }
    await runJob(disabled, ctx())
    expect(skipped).not.toHaveBeenCalled()

    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failed: Job = { name: 'failed job', everyMs: 1, run: async () => { throw new Error('boom') } }
    await expect(runJob(failed, ctx())).resolves.toBeUndefined()
    expect(logged).toHaveBeenCalledWith('failed job failed', expect.any(Error))
    logged.mockRestore()
  })
})
