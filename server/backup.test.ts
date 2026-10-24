/**
 * The drill, automated: take a backup of a workspace that exists, put it somewhere else, and prove
 * the workspace is the same one.
 *
 * R3 asks for a restore into a scratch environment compared with a known workspace. A test is the
 * cheapest honest version of that — it runs on every push rather than on the day it is needed — and
 * the runbook in `docs/backup.md` records the manual drill for the provider's own backups, which a
 * test cannot reach.
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { backupDatabase, latestBackup, prune, restoreDatabase } from './backup'
import { fromSqlite, openSqlite } from './sqlite'
import { readWorkspace } from './workspace/read'
import { writeWorkspace } from './workspace/write'
import type { Workspace } from './workspace/types'

const MIGRATIONS = new URL('../migrations/', import.meta.url)

const workspace: Workspace = {
  users: [{ id: 'u-ada', name: 'Ada' }],
  issueTypes: [{ id: 't-card', name: 'Card', color: '#3b82f6' }],
  boards: [{ id: 'b-atlas', name: 'Team Atlas', band: 'team', description: 'Kept in every copy.' }],
  lanes: [
    { id: 'l-backlog', boardId: 'b-atlas', parentId: null, order: 0, name: 'Backlog', workflow: 'cards', stage: 'backlog' },
  ],
  items: [
    {
      id: 'i-card',
      title: 'A card worth restoring',
      typeId: 't-card',
      createdAt: 1_700_000_000_000,
      rev: 3,
      log: [{ id: 'e-1', at: 1_700_000_000_000, kind: 'created', by: 'u-ada' }],
    },
  ],
  edges: [],
  links: [],
  objectives: [],
  keyResults: [],
  boardTemplates: [],
  savedFilters: [],
  collapsedLanes: {},
  boardId: 'b-atlas',
  placements: [{ id: 'p-1', boardId: 'b-atlas', itemId: 'i-card', laneId: 'l-backlog' }],
}

let scratch: string | undefined

function working(): string {
  scratch = mkdtempSync(join(tmpdir(), 'flowline-backup-'))
  const path = join(scratch, 'flowline.db')

  const raw = new DatabaseSync(path)
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    raw.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  }
  raw.close()

  const db = openSqlite(path)
  void writeWorkspace(db, workspace, 'workspace')
  return path
}

afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true })
  scratch = undefined
})

describe('a backup of a self-hosted workspace', () => {
  it('can be restored into a scratch environment, and is the same workspace', async () => {
    const live = working()
    const directory = join(scratch!, 'backups')

    const copy = backupDatabase({ from: live, directory })
    expect(existsSync(copy.path)).toBe(true)
    expect(copy.bytes).toBeGreaterThan(0)

    const restored = join(scratch!, 'restored.db')
    const counts = restoreDatabase({ from: copy.path, to: restored })
    expect(counts).toEqual({ boards: 1, items: 1 })

    // The comparison R3 asks for: not "a file arrived" but "this is the workspace".
    const back = await readWorkspace(fromSqlite(new DatabaseSync(restored)))
    expect(back).toEqual(workspace)
  })

  it('is consistent, because it is a read transaction and not a file copy', () => {
    const live = working()
    const copy = backupDatabase({ from: live, directory: join(scratch!, 'backups') })

    const db = new DatabaseSync(copy.path, { readOnly: true })
    const integrity = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
    db.close()
    expect(integrity.integrity_check).toBe('ok')
  })

  it('will not overwrite a database unless it is told to', () => {
    const live = working()
    const copy = backupDatabase({ from: live, directory: join(scratch!, 'backups') })

    expect(() => restoreDatabase({ from: copy.path, to: live })).toThrow(/refusing to overwrite/)
    // Told to, it does — a restore is run on a bad day, and the second mistake must not be this.
    expect(restoreDatabase({ from: copy.path, to: live, force: true })).toEqual({ boards: 1, items: 1 })
  })

  it('keeps a window, and forgets what is older than it', () => {
    const directory = join(scratch ?? mkdtempSync(join(tmpdir(), 'flowline-prune-')), 'backups')
    const live = working()
    const old = backupDatabase({ from: live, directory, now: new Date('2026-09-01T02:00:00Z') })
    const recent = backupDatabase({ from: live, directory, now: new Date('2026-10-23T02:00:00Z') })

    // Age is the file's own time, which is what a person would check.
    const ancient = new Date('2026-09-01T02:00:00Z').getTime() / 1000
    utimesSync(old.path, ancient, ancient)

    const removed = prune(directory, 30, new Date('2026-10-23T03:00:00Z'))
    expect(removed).toEqual([old.path])
    expect(latestBackup(directory)).toBe(recent.path)
  })

  it('says so when there is nothing to copy', () => {
    expect(() => backupDatabase({ from: '/nowhere/flowline.db', directory: '/tmp' })).toThrow(/no database/)
  })
})
