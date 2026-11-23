/**
 * The periodic work both runtimes must do, in one list.
 *
 * The entries still own *how* they schedule: a Node process has intervals, a Worker has a cron
 * trigger and `waitUntil`. What they no longer own is the list, its intervals, or each failure's
 * sentence. A job added here runs on both runtimes without a second wiring.
 */

import type { Database } from './db'
import type { Mail } from './mail'
import { pruneAudit } from './audit'
import { pruneErrors } from './errors'
import { sendDigests } from './digest'
import { dispatchDue } from './webhooks'
import { changeRetentionDays, pruneChanges } from './workspace/changes'

export interface JobContext {
  db: Database
  env: unknown
  /** A relay, on the runtime that has one. The Worker passes none. */
  mail?: Mail
}

export interface Job {
  name: string
  /** How often a long-running process should repeat it. The Worker's cron decides its own wall. */
  everyMs: number
  /** A deployment switch or a missing capability; the entry does not schedule it when false. */
  enabled?: (ctx: JobContext) => boolean
  run: (ctx: JobContext) => Promise<unknown>
}

const setting = (env: unknown, key: string): string | undefined => {
  const value = (env as Record<string, unknown> | undefined)?.[key]
  return typeof value === 'string' ? value : undefined
}

export const JOBS: Job[] = [
  {
    name: 'webhook dispatch',
    everyMs: 15_000,
    enabled: ({ env }) => setting(env, 'WEBHOOKS') !== '0',
    run: ({ db }) => dispatchDue(db),
  },
  {
    name: 'change feed prune',
    everyMs: 15_000,
    run: ({ db, env }) => pruneChanges(db, { days: changeRetentionDays(env) }),
  },
  {
    name: 'audit prune',
    everyMs: 3_600_000,
    run: ({ db }) => pruneAudit(db),
  },
  {
    name: 'error log prune',
    everyMs: 3_600_000,
    run: ({ db }) => pruneErrors(db),
  },
  {
    name: 'mail digest',
    everyMs: 30_000,
    enabled: ({ env, mail }) => Boolean(mail) && setting(env, 'MAIL_DIGEST') !== '0',
    run: ({ db, env, mail }) => sendDigests(db, { mail, env }),
  },
]

/** Whether an entry should install this job at all. */
export function jobEnabled(job: Job, ctx: JobContext): boolean {
  return !job.enabled || job.enabled(ctx)
}

/** Run one job, keeping its failure out of the next tick and naming it in the log. */
export async function runJob(job: Job, ctx: JobContext): Promise<void> {
  if (!jobEnabled(job, ctx)) return
  try {
    await job.run(ctx)
  } catch (error) {
    console.error(`${job.name} failed`, error)
  }
}
