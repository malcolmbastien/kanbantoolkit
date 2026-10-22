/**
 * Apply this project's migrations to a SQLite file.
 *
 * The same files D1 applies — that is the point of a SQLite-first schema — and the same ones a
 * self-hosted instance runs on its first start. Used by the e2e harness to give the Node entry a
 * database that already has its tables.
 *
 *   node scripts/migrate.mjs path/to/flowline.db
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const root = fileURLToPath(new URL('..', import.meta.url))
const migrations = join(root, 'migrations')
const target = process.argv[2]

if (!target) {
  console.error('usage: node scripts/migrate.mjs <database>')
  process.exit(1)
}

const db = new DatabaseSync(target)
for (const file of readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) {
  db.exec(readFileSync(join(migrations, file), 'utf8'))
}
db.close()
console.log(`Applied ${readdirSync(migrations).filter((name) => name.endsWith('.sql')).length} migration(s) to ${target}.`)
