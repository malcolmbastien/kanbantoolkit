import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { fileBackups } from './file-backup'

const MIGRATIONS = new URL('../migrations/', import.meta.url)
let scratch: string | undefined

function working(): string {
  scratch = mkdtempSync(join(tmpdir(), 'kanbantoolkit-file-backup-'))
  const path = join(scratch, 'kanbantoolkit.db')
  const raw = new DatabaseSync(path)
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    raw.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  }
  raw.exec(`
    INSERT INTO boards (id, name, band, description, position, workspace_id)
      VALUES ('b-1', 'Atlas', 'team', 'Kept.', 0, 'workspace');
    INSERT INTO items (id, title, type_id, created_at, rev, workspace_id)
      VALUES ('i-1', 'A card', 't-card', 1700000000000, 1, 'workspace');
  `)
  raw.close()
  return path
}

afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true })
  scratch = undefined
})

describe('the Node filesystem backup runtime', () => {
  it('takes a copy, lists it, downloads it, and refuses a name that climbs out', async () => {
    const live = working()
    const backups = fileBackups(live)
    const copy = await backups.create(new Date('2026-10-30T02:00:00Z'))
    expect(copy.name).toMatch(/^kanbantoolkit-2026-10-30T02-00-00-000\.db$/)
    expect(copy.bytes).toBeGreaterThan(0)
    expect(backups.list().map((entry) => entry.name)).toEqual([copy.name])
    expect(backups.read(copy.name)?.byteLength).toBe(copy.bytes)
    expect(backups.read('../kanbantoolkit.db')).toBeUndefined()
  })

  it('verifies an upload and stages it, without touching the live database', async () => {
    const live = working()
    const backups = fileBackups(live)
    const copy = await backups.create(new Date('2026-10-30T02:00:00Z'))
    const bytes = backups.read(copy.name)!
    const before = readFileSync(live).byteLength

    expect(backups.stageRestore(bytes)).toEqual({ boards: 1, items: 1, name: 'pending-restore.db' })
    expect(readFileSync(live).byteLength).toBe(before)
    expect(existsSync(join(scratch!, 'pending-restore.db'))).toBe(true)
  })

  it('refuses a file that is not a database', () => {
    const live = working()
    const backups = fileBackups(live)
    const junk = join(scratch!, 'not-a-database.db')
    writeFileSync(junk, 'not sqlite')
    expect(() => backups.stageRestore(new Uint8Array(readFileSync(junk)))).toThrow()
    expect(existsSync(join(scratch!, 'pending-restore.db'))).toBe(false)
  })
})
