/**
 * Delivering what people watch: one plain-text message per person per period.
 *
 * The message is computed **at send time** from the outbox and the graph, never stored as a
 * snapshot. A digest that said "at risk" on Monday and was read on Wednesday would be quoting a
 * reading the board has since changed; this one is a sentence about the work as it is when the
 * message is written.
 *
 * Nothing here is per event. A card moved five times in an afternoon is one line, because a person
 * wants to know where the work is, not to receive five emails about the way it got there.
 *
 * Plain text, no HTML, no remote images, no link whose fetch marks a reader. The two links it does
 * carry are tokens (see `mail-token.ts`): one stops the email, one opens the profile.
 *
 * A deployment with no relay never reaches this file's `mail` path — the caller passes no mailer,
 * and the report says so. Nothing phones home: the only transport is the operator's own SMTP.
 */

import { publicBase } from './config'
import type { Database } from './db'
import type { Mail } from './mail'
import { mailToken } from './mail-token'
import { inboxRowsOf, type InboxLookup } from './watch'
import { readWorkspace } from './workspace/read'
import type { Workspace } from './workspace/types'
import type { Board, Lane, Placement, User } from '../src/domain/types'
import { inboxSentence } from '../src/domain/inbox'

type Row = Record<string, unknown>
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const number = (value: unknown): number => (typeof value === 'number' ? value : 0)

export type MailFrequency = 'immediate' | 'daily' | 'weekly'

export const MAIL_FREQUENCIES: MailFrequency[] = ['immediate', 'daily', 'weekly']

export interface DigestReport {
  /** Messages actually sent. */
  sent: number
  /** People whose period was due but who had nothing to say, or who were not due yet. */
  skipped: number
  /** This deployment has no mailer, so delivery is not offered at all. */
  unavailable: boolean
}

export interface DigestOptions {
  mail?: Mail
  /** The runtime's configuration: `PUBLIC_URL` makes the links in the message clickable. */
  env?: unknown
  now?: number
  /** How many people one run may write to; the scheduler's own bound. */
  limit?: number
}

const DAY = 86_400_000
/** A digest is a reading, not the archive: a burst beyond this continues in the next run. */
const EVENT_CAP = 500
/** The scheduler's default bound for one run. */
const RUN_LIMIT = 100

interface Recipient {
  id: string
  name: string
  email: string
  timezone: string
  frequency: MailFrequency
  lastSentAt: number
  lastSentSeq: number
}

/**
 * The local parts of an instant, in a person's time zone.
 *
 * `Intl` is the only honest test of a zone the runtime knows. A row written before the profile
 * validated one falls back to UTC rather than failing the digest for everybody else.
 */
function localParts(now: number, timeZone: string): { day: string; hour: number; weekday: string } {
  const at = new Date(now)
  const read = (zone: string) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    }).formatToParts(at)
    const value = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
    return {
      day: `${value('year')}-${value('month')}-${value('day')}`,
      hour: Number(value('hour')),
      weekday: value('weekday'),
    }
  }
  try {
    return read(timeZone || 'UTC')
  } catch {
    return read('UTC')
  }
}

/**
 * Whether this person's next digest is due.
 *
 * `immediate` is due on every run that has something to say (the caller decides that, because it
 * needs the events). `daily` and `weekly` are due at 08:00 in the reader's own morning — the time
 * zone is what makes the sentence mean the reader's morning rather than the server's.
 */
export function digestDue(frequency: MailFrequency, timeZone: string, now: number, lastSentAt: number): boolean {
  if (frequency === 'immediate') return true
  const local = localParts(now, timeZone)
  if (local.hour < 8) return false

  if (frequency === 'daily') {
    if (!lastSentAt) return true
    return localParts(lastSentAt, timeZone).day !== local.day
  }

  // Weekly: Monday morning, and not the same Monday twice. The two-day guard is for a time-zone
  // edge that lands the scheduler on a second Monday reading, not a way to count weeks by hours —
  // a person who turns email on on Tuesday still gets the next Monday.
  if (local.weekday !== 'Mon') return false
  if (!lastSentAt) return true
  return localParts(lastSentAt, timeZone).day !== local.day && now - lastSentAt >= 2 * DAY
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** "Wed 5 Nov" — a due date in the words a person reads, not an ISO string. */
function dayLabel(day: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(new Date(`${day}T00:00:00Z`))
  } catch {
    return day
  }
}

function lookupOf(state: Workspace): InboxLookup {
  const placementByItem = new Map<string, { boardId?: string; laneId?: string }>()
  const placements: Placement[] = state.placements
  for (const placement of placements) {
    placementByItem.set(placement.itemId, { boardId: placement.boardId, laneId: placement.laneId })
  }
  return {
    itemById: new Map(state.items.map((item) => [item.id, item])),
    placementByItem,
    boardName: new Map(state.boards.map((board: Board) => [board.id, board.name])),
    laneName: new Map(state.lanes.map((lane: Lane) => [lane.id, lane.name])),
    personName: new Map(state.users.map((user: User) => [user.id, user.name])),
  }
}

interface DigestBody {
  subject: string
  text: string
  /** Whether there is anything to say. A due reminder is something to say. */
  hasContent: boolean
}

/**
 * One person's message, from the events after their last digest and the workspace as it is now.
 *
 * The order is the order a person acts on it: what changed on the work they watch, what was
 * assigned, where they were named, what is due, and the initiatives that went at risk.
 */
export async function buildDigest(options: {
  recipient: Recipient
  workspaceId: string
  workspaceName: string
  state: Workspace
  watchedIds: string[]
  /** Where each watch began: events at or before this position are history, not news. */
  watchSince: Map<string, number>
  events: Row[]
  now: number
  base?: string
  env?: unknown
}): Promise<DigestBody & { hasEvent: boolean }> {
  const { recipient, state, now } = options
  const rows = [...inboxRowsOf(options.events, lookupOf(state), Number.MAX_SAFE_INTEGER)].sort(
    (left, right) => right.at - left.at || right.id.localeCompare(left.id),
  )
  const watched = new Set(options.watchedIds)
  const beganAt = (row: { itemId: string; seq?: number }) =>
    (row.seq ?? 0) > (options.watchSince.get(row.itemId) ?? 0)
  const assignedIds = new Set(
    state.items.filter((item) => item.assignees?.includes(recipient.id) && !item.archived).map((item) => item.id),
  )

  const watchedLines: string[] = []
  const assignedLines: string[] = []
  const mentionLines: string[] = []
  const healthLines: string[] = []
  const used = new Set<string>()

  // Assignment first: an item that was put in your hands is the strongest reason to open the board.
  const assignmentEvents = rows.filter(
    (row) =>
      assignedIds.has(row.itemId) &&
      (row.type === 'item.created' ||
        (row.type === 'item.updated' && (row.fields ?? []).includes('assignees'))),
  )
  for (const row of assignmentEvents) {
    if (used.has(`a:${row.itemId}`)) continue
    used.add(`a:${row.itemId}`)
    assignedLines.push(`- ${row.itemTitle} — ${inboxSentence(row)}`)
  }

  // A mention is one line per note, not one per card, because a mention is a sentence addressed to
  // a person.
  for (const row of rows) {
    if (row.type !== 'item.noted' || !row.mentions?.includes(recipient.id)) continue
    const key = `m:${row.entryId ?? row.id}`
    if (used.has(key)) continue
    used.add(key)
    mentionLines.push(`- ${row.itemTitle} — ${row.actor ?? 'Somebody'} mentioned you`)
  }

  // An initiative that went at risk is its own section: a reader scans for trouble.
  for (const row of rows) {
    if (row.type !== 'initiative.health_changed' || row.health?.after !== 'atRisk') continue
    if (!beganAt(row)) continue
    const key = `h:${row.itemId}`
    if (used.has(key)) continue
    used.add(key)
    healthLines.push(`- ${inboxSentence(row)}`)
  }

  // What was assigned or where a name was spoken has its own line; the same item is not repeated
  // as "a watched item changed" underneath it.
  const spoken = new Set<string>()
  for (const row of rows) {
    if (used.has(`a:${row.itemId}`) || used.has(`h:${row.itemId}`)) spoken.add(row.itemId)
  }
  for (const row of rows) {
    if (row.type !== 'item.noted' || !row.mentions?.includes(recipient.id)) continue
    spoken.add(row.itemId)
  }

  // Everything else about a watched item, one line per item, the newest change standing for the
  // item's news. A five-move afternoon is one sentence, not five.
  for (const row of rows) {
    if (row.type === 'initiative.health_changed') continue
    if (!watched.has(row.itemId) || spoken.has(row.itemId) || !beganAt(row)) continue
    const key = `w:${row.itemId}`
    if (used.has(key)) continue
    used.add(key)
    const count = rows.filter(
      (candidate) => candidate.itemId === row.itemId && watched.has(candidate.itemId),
    ).length
    watchedLines.push(`- ${inboxSentence(row)}${count > 1 ? ` (${count} changes)` : ''}`)
  }

  // Due: the cards in this person's care whose promise falls inside the window. Overdue work is
  // said plainly rather than folded into "this week".
  const today = localParts(now, recipient.timezone).day
  const end = addDays(today, 7)
  const dueLines: string[] = []
  for (const item of state.items) {
    if (item.archived || !item.dueDate) continue
    const mine = assignedIds.has(item.id) || watched.has(item.id)
    if (!mine) continue
    if (item.dueDate > end) continue
    dueLines.push(
      item.dueDate < today
        ? `- ${item.title} — overdue since ${dayLabel(item.dueDate)}`
        : `- ${item.title} — due ${dayLabel(item.dueDate)}`,
    )
  }
  dueLines.sort()

  const sections: string[] = []
  if (watchedLines.length) sections.push(`Changes on the work you watch\n${watchedLines.join('\n')}`)
  if (assignedLines.length) sections.push(`Assigned to you\n${assignedLines.join('\n')}`)
  if (mentionLines.length) sections.push(`You were mentioned\n${mentionLines.join('\n')}`)
  if (dueLines.length) sections.push(`Due this week\n${dueLines.join('\n')}`)
  if (healthLines.length) sections.push(`Watched initiatives at risk\n${healthLines.join('\n')}`)

  if (!sections.length) return { subject: '', text: '', hasContent: false, hasEvent: false }

  const since = recipient.lastSentAt
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: recipient.timezone || 'UTC',
        weekday: 'long',
        day: 'numeric',
        month: 'short',
      }).format(new Date(recipient.lastSentAt))
    : undefined
  const subject =
    recipient.frequency === 'weekly'
      ? `Your week on ${options.workspaceName}`
      : recipient.frequency === 'daily'
        ? `Your day on ${options.workspaceName}`
        : `${options.workspaceName} — what changed`

  const lines = [
    since ? `Since ${since}.` : `Here is what is happening on ${options.workspaceName}.`,
    '',
    ...sections.flatMap((section) => [section, '']),
  ]

  if (options.base) {
    const unsubscribe = await mailToken(options.env, options.workspaceId, recipient.id, 'unsubscribe')
    const preferences = await mailToken(options.env, options.workspaceId, recipient.id, 'preferences')
    lines.push(
      `Open the board: ${options.base}/app`,
      `Change what you receive: ${options.base}/api/mail/preferences?token=${preferences}`,
      `Stop these emails: ${options.base}/api/mail/unsubscribe?token=${unsubscribe}`,
      '',
      'This message is plain text: there is nothing in it that tells us whether you opened it.',
    )
  } else {
    lines.push('Open your instance to change what you receive.')
  }

  const hasEvent = watchedLines.length > 0 || assignedLines.length > 0 || mentionLines.length > 0 || healthLines.length > 0
  return { subject, text: lines.join('\n'), hasContent: true, hasEvent }
}

/**
 * Send every digest that is due.
 *
 * One workspace at a time, one person at a time, bounded by `limit`. A person with nothing to say
 * has their period advanced without a message: "no news" is not an email, and re-reading the same
 * empty window on every tick would be work for nobody.
 */
export async function sendDigests(db: Database, options: DigestOptions = {}): Promise<DigestReport> {
  const mail = options.mail
  if (!mail) return { sent: 0, skipped: 0, unavailable: true }

  const now = options.now ?? Date.now()
  const limit = options.limit ?? RUN_LIMIT
  const base = publicBase(options.env)
  let sent = 0
  let skipped = 0

  const workspaces = await db.all<Row>('SELECT id, name FROM workspaces ORDER BY created_at, id')
  for (const workspace of workspaces) {
    const workspaceId = text(workspace.id)
    const workspaceName = text(workspace.name) || 'Kanban Toolkit'
    const state = await readWorkspace(db, workspaceId, { history: false })
    if (state.items.length === 0) continue

    const recipients = await db.all<Row>(
      `SELECT u.id AS id, u.name AS name, u.email AS email, u.timezone AS timezone,
              u.mail_frequency AS frequency,
              COALESCE(ms.last_sent_at, 0) AS last_sent_at,
              COALESCE(ms.last_sent_seq, 0) AS last_sent_seq
         FROM users u
         LEFT JOIN mail_state ms ON ms.user_id = u.id AND ms.workspace_id = ?1
        WHERE u.mail_on = 1 AND u.status = 'active'
          AND (
            EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = ?1 AND wm.user_id = u.id)
            OR EXISTS (
              SELECT 1 FROM group_members gm
                JOIN groups g ON g.id = gm.group_id AND g.active = 1
                JOIN group_workspace_roles r ON r.group_id = g.id
               WHERE r.workspace_id = ?1 AND gm.user_id = u.id
            )
          )
        ORDER BY u.id`,
      [workspaceId],
    )

    for (const row of recipients) {
      if (sent >= limit) return { sent, skipped, unavailable: false }
      const recipient: Recipient = {
        id: text(row.id),
        name: text(row.name),
        email: text(row.email),
        timezone: text(row.timezone),
        frequency: (text(row.frequency) || 'daily') as MailFrequency,
        lastSentAt: number(row.last_sent_at),
        lastSentSeq: number(row.last_sent_seq),
      }
      if (!recipient.email || !digestDue(recipient.frequency, recipient.timezone, now, recipient.lastSentAt)) {
        skipped += 1
        continue
      }

      const events = await db.all<Row>(
        `SELECT id, seq, type, payload, occurred_at, actor_id, item_id
           FROM outbound_events
          WHERE workspace_id = ?1 AND seq > ?2
          ORDER BY seq ASC
          LIMIT ?3`,
        [workspaceId, recipient.lastSentSeq, EVENT_CAP],
      )
      const newest = events.length ? number(events[events.length - 1].seq) : recipient.lastSentSeq
      const watches = await db.all<Row>(
        'SELECT item_id, since_seq FROM item_watch WHERE workspace_id = ?1 AND user_id = ?2',
        [workspaceId, recipient.id],
      )
      const watchSince = new Map(watches.map((watch) => [text(watch.item_id), number(watch.since_seq)]))
      const watchedIds = [...watchSince.keys()]

      const digest = await buildDigest({
        recipient,
        workspaceId,
        workspaceName,
        state,
        watchedIds,
        watchSince,
        events,
        now,
        ...(base ? { base } : {}),
        ...(options.env ? { env: options.env } : {}),
      })

      // An immediate message with no event is not news; a daily one may still have a due reminder
      // to say, which `hasContent` already accounts for.
      if (!digest.hasContent || (recipient.frequency === 'immediate' && !digest.hasEvent)) {
        skipped += 1
        await remember(db, workspaceId, recipient.id, now, newest)
        continue
      }

      try {
        const unsubscribe = base
          ? await mailToken(options.env, workspaceId, recipient.id, 'unsubscribe')
          : undefined
        await mail.send({
          to: recipient.email,
          subject: digest.subject,
          text: digest.text,
          ...(base && unsubscribe
            ? {
                headers: {
                  'List-Unsubscribe': `<${base}/api/mail/unsubscribe?token=${unsubscribe}>`,
                  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
                },
              }
            : {}),
        })
        sent += 1
        await remember(db, workspaceId, recipient.id, now, newest)
      } catch (error) {
        // The cursor stays where it was, so the next run tries again rather than losing the news.
        console.error('mail digest failed', error)
        skipped += 1
      }
    }
  }

  return { sent, skipped, unavailable: false }
}

async function remember(db: Database, workspaceId: string, userId: string, at: number, seq: number): Promise<void> {
  await db.run(
    `INSERT INTO mail_state (workspace_id, user_id, last_sent_at, last_sent_seq) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET last_sent_at = excluded.last_sent_at,
                                                     last_sent_seq = excluded.last_sent_seq`,
    [workspaceId, userId, at, seq],
  )
}
