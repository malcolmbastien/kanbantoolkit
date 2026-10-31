/**
 * The Node half of Admin's backups: a directory of copies, and a staged restore.
 *
 * This is deliberately outside `server/backup.ts`: that file is the command line's own and knows how
 * to copy and verify, while this one is the shape the HTTP route asks for. Keeping the filesystem
 * here is what lets `server/backup-routes.ts` stay free of Node imports and run unchanged on a
 * runtime that has no files.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { backupDatabase, restoreDatabase } from './backup'
import type { BackupFile, BackupRuntime } from './runtime'

const NAME = /^kanbantoolkit-[0-9T.-]+\.db$/

/** A filesystem-backed `BackupRuntime` for a database at `path`. */
export function fileBackups(path: string): BackupRuntime {
  const directory = process.env.BACKUP_DIR ?? join(dirname(path), 'backups')
  const keepDays = Number(process.env.BACKUP_KEEP_DAYS ?? 30) || 30
  const named = (name: string) => NAME.test(name) && basename(name) === name

  const listing = (): BackupFile[] => {
    if (!existsSync(directory)) return []
    return readdirSync(directory)
      .filter(named)
      .map((name) => {
        const file = join(directory, name)
        return { name, bytes: statSync(file).size, createdAt: statSync(file).mtimeMs }
      })
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  return {
    create(now = new Date()) {
      const copy = backupDatabase({ from: path, directory, keepDays, now })
      return { name: basename(copy.path), bytes: copy.bytes, createdAt: statSync(copy.path).mtimeMs }
    },
    list: listing,
    read(name) {
      if (!named(name)) return undefined
      const file = join(directory, name)
      return existsSync(file) ? new Uint8Array(readFileSync(file)) : undefined
    },
    stageRestore(bytes: Uint8Array) {
      mkdirSync(directory, { recursive: true })
      const id = crypto.randomUUID()
      const uploaded = join(directory, `.upload-${id}.db`)
      const scratch = join(directory, `.verify-${id}.db`)
      const pending = join(dirname(path), 'pending-restore.db')
      writeFileSync(uploaded, bytes)
      try {
        // Verify the upload by putting it somewhere else and asking the same function the CLI uses.
        const counts = restoreDatabase({ from: uploaded, to: scratch, force: true })
        rmSync(pending, { force: true })
        renameSync(uploaded, pending)
        return { ...counts, name: basename(pending) }
      } finally {
        rmSync(uploaded, { force: true })
        rmSync(scratch, { force: true })
      }
    },
  }
}
