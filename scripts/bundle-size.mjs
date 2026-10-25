// What the first download is, measured rather than guessed.
//
// Vite writes a manifest naming every file and what it imports. The board's own path is the entry
// and its static imports; every other screen is a dynamic import, and is in the manifest under
// `dynamicImports`, which this does not follow. Sizes are gzipped, because that is what the
// browser transfers.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const DIST = 'dist'
/**
 * The first download's JavaScript may not exceed this, compressed.
 *
 * 120 KB was the target; the split measured 153.8 KB. What is left is the board's own path —
 * 115 KB of the app's code, which is the store and the domain every screen shares, plus React's
 * 2.4 KB runtime and 39 KB of React itself. Reaching 120 KB would mean splitting the store, which
 * every screen needs.
 *
 * The number moves in deliberate steps, not by drift: 153.8 at the split, 155.0 when the account
 * control arrived (task 117), 158 for the account and sync controls, 160 for the lease — the
 * presence store and the lease client are shared between the entry and the drawer, so they land in
 * the chunk both load — 162 for the live channel's socket client (task 118.5), which the store
 * starts on sign-in and so cannot be a screen of its own — and 163 when the move rule left the store
 * for `src/domain/move.ts` (task 169), where the REST API and an agent's `move_item` ask the same
 * function. The rule is on the first-download path because a drag uses it, and its refusal sentences
 * are part of it. A raise belongs in this comment, with a reason, which is what makes it a decision
 * rather than a regression.
 */
const LIMIT_KB = Number(process.env.SIZE_LIMIT_KB ?? 163)

let manifest
try {
  manifest = JSON.parse(readFileSync(join(DIST, '.vite/manifest.json'), 'utf8'))
} catch {
  console.error('No build to measure: run `npm run build` first.')
  process.exit(1)
}

const entry = manifest['app/index.html']
if (!entry) {
  console.error('The manifest has no "app/index.html" entry — the build did not produce the app.')
  process.exit(1)
}

/** The entry and everything it imports synchronously. Dynamic imports are screens, not this. */
const files = new Set()
const walk = (key) => {
  const chunk = manifest[key]
  if (!chunk || files.has(chunk.file)) return
  files.add(chunk.file)
  for (const imported of chunk.imports ?? []) walk(imported)
}
walk('app/index.html')

const gz = (file) => gzipSync(readFileSync(join(DIST, file))).length
const total = [...files].reduce((sum, file) => sum + gz(file), 0)
const kb = total / 1024

console.log(`First download: ${kb.toFixed(1)} KB compressed, in ${files.size} file(s).`)
for (const file of files) console.log(`  ${(gz(file) / 1024).toFixed(1).padStart(6)} KB  ${file}`)

if (kb > LIMIT_KB) {
  console.error(`Over the ${LIMIT_KB} KB limit by ${(kb - LIMIT_KB).toFixed(1)} KB.`)
  process.exit(1)
}
console.log(`Within the ${LIMIT_KB} KB limit.`)
