/**
 * A copy of a self-hosted workspace, and putting it back.
 *
 * The copy is taken with `VACUUM INTO`, which is a read transaction rather than a file copy: a file
 * copied while the app is writing can catch a half-written page, and a backup that is only *usually*
 * good is not a backup. The restore verifies what it wrote — integrity first, then the counts — so
 * a drill can say "the workspace is there" rather than "the file moved".
 *
 * Both are the Node half. On Cloudflare the database has its own facility, and `docs/backup.md`
 * says what that is; the export from the app is the third road, available to the person who owns
 * the workspace (R5), and it is what a drill compares against.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export interface Backup {
  path: string
  bytes: number
}

export interface Restored {
  boards: number
  items: number
}

const PREFIX = 'flowline-'

/** `2026-10-23T02:00:00.000Z` → `2026-10-23T02-00-00-000`. A filename, not a parsed date. */
function stamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-').replace('Z', '')
}

/**
 * Delete backups older than `keepDays`, measured by the file's own time.
 *
 * By mtime rather than by parsing the name: the name is for people, the timestamp is the record.
 */
export function prune(directory: string, keepDays: number, now = new Date()): string[] {
  if (!existsSync(directory)) return []
  const cutoff = now.getTime() - keepDays * 86_400_000
  const removed: string[] = []

  for (const file of readdirSync(directory)) {
    if (!file.startsWith(PREFIX) || !file.endsWith('.db')) continue
    const path = join(directory, file)
    if (statSync(path).mtimeMs < cutoff) {
      rmSync(path)
      removed.push(path)
    }
  }
  return removed
}

export function backupDatabase(input: {
  from: string
  directory: string
  now?: Date
  keepDays?: number
}): Backup {
  if (!existsSync(input.from)) throw new Error(`no database at ${input.from}`)

  const now = input.now ?? new Date()
  mkdirSync(input.directory, { recursive: true })
  const path = join(input.directory, `${PREFIX}${stamp(now)}.db`)

  const db = new DatabaseSync(input.from, { readOnly: true })
  try {
    // One statement, one read transaction. `VACUUM INTO` also compacts, so the copy is the size of
    // the data rather than the size of everything that ever was.
    db.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`)
  } finally {
    db.close()
  }

  prune(input.directory, input.keepDays ?? 30, now)
  return { path, bytes: statSync(path).size }
}

/**
 * Put a backup where a server will read it.
 *
 * Refuses to overwrite without `force`: a restore is run on a day something has already gone wrong,
 * and the second mistake that day must not be this function's.
 */
export function restoreDatabase(input: { from: string; to: string; force?: boolean }): Restored {
  if (!existsSync(input.from)) throw new Error(`no backup at ${input.from}`)
  if (existsSync(input.to) && !input.force) {
    throw new Error(`refusing to overwrite ${input.to} — pass --force if that is what you mean`)
  }

  mkdirSync(dirname(input.to), { recursive: true })
  copyFileSync(input.from, input.to)

  // Verify the file that was written, not the one that was read.
  const db = new DatabaseSync(input.to, { readOnly: true })
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined
    if (integrity?.integrity_check !== 'ok') throw new Error(`the restored database is not sound: ${integrity?.integrity_check}`)

    const counts = db
      .prepare('SELECT (SELECT COUNT(*) FROM boards) AS boards, (SELECT COUNT(*) FROM items) AS items')
      .get() as unknown as Restored
    return { boards: counts.boards, items: counts.items }
  } finally {
    db.close()
  }
}

/** The newest backup in a directory, for a restore that needs no date typed in. */
export function latestBackup(directory: string): string | undefined {
  if (!existsSync(directory)) return undefined
  const files = readdirSync(directory)
    .filter((file) => file.startsWith(PREFIX) && file.endsWith('.db'))
    .map((file) => join(directory, file))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
  return files[0]
}

// ---- the command line --------------------------------------------------------
//   tsx server/backup.ts backup  <database> <directory> [--keep-days=30]
//   tsx server/backup.ts restore <backup>   <database>  [--force]

function main(argv: string[]): void {
  const [command, first, second, ...rest] = argv
  const force = [...rest, second].includes('--force')
  const keep = Number([...rest].find((arg) => arg.startsWith('--keep-days='))?.split('=')[1] ?? 30)

  if (command === 'backup' && first && second) {
    const copy = backupDatabase({ from: first, directory: second, keepDays: keep })
    console.log(`backed up ${first} → ${copy.path} (${(copy.bytes / 1024).toFixed(0)} KB, keeping ${keep} days)`)
    return
  }

  if (command === 'restore' && first && second) {
    const counts = restoreDatabase({ from: first, to: second, force })
    console.log(`restored ${first} → ${second} (${counts.boards} boards, ${counts.items} items)`)
    return
  }

  console.error('usage: tsx server/backup.ts backup <database> <directory> [--keep-days=30]')
  console.error('       tsx server/backup.ts restore <backup> <database> [--force]')
  process.exit(1)
}

// Only when run as a command: importing this from a test must not back anything up.
if (process.argv[1]?.endsWith(`backup.ts`) || process.argv[1]?.endsWith(`backup.js`)) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    // A person running this on a bad day wants the sentence, not a stack trace.
    console.error(`backup: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
