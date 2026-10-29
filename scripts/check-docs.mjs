// The documentation, checked as files rather than as prose.
//
// Task 167 promises three things a machine can hold: every relative link resolves, every document in
// `docs/` is listed in `docs/README.md`, and the commands the pages quote are the ones `package.json`
// actually runs. A doc that links nowhere is a page nobody follows; a command that does not exist is
// worse, because it is followed and fails.
//
//   npm run docs:check
//
// It reads the repository, not a build: the docs are markdown in git, rendered by GitHub, and this
// is the check that they stay that way.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { WIKI_PAGES } from './wiki.mjs'

const ROOT = process.cwd()
const DOCS = join(ROOT, 'docs')

/** The documents a reader meets first, checked the same way as the ones under `docs/`. */
const ROOT_DOCS = ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md', 'AGENTS.md']

const problems = []
const fail = (message) => problems.push(message)

/** Every markdown file that is part of the documentation, by path. */
function documents() {
  const found = ROOT_DOCS.filter((name) => existsSync(join(ROOT, name))).map((name) => join(ROOT, name))
  for (const name of readdirSync(DOCS)) {
    if (name.endsWith('.md')) found.push(join(DOCS, name))
  }
  return found
}

const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts ?? {}

const files = documents()
if (!files.length) fail('no documentation found')

/** A link's target, without its fragment or query — those are the page's business, not the file's. */
const targetOf = (href) => decodeURIComponent(href.split('#')[0].split('?')[0])

for (const file of files) {
  const where = file.slice(ROOT.length + 1)
  const text = readFileSync(file, 'utf8')

  // ---- every relative link resolves ----
  for (const [, href] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(https?:|mailto:|#)/.test(href)) continue
    const target = targetOf(href)
    if (!target) continue
    const path = resolve(dirname(file), target)
    if (!existsSync(path)) fail(`${where}: links to ${href}, which does not exist`)
  }

  // ---- every quoted command is one package.json runs ----
  for (const [, command] of text.matchAll(/npm run ([a-z][\w:-]*)/g)) {
    if (!(command in scripts)) fail(`${where}: quotes "npm run ${command}", which package.json does not define`)
  }
  // A script named without `run` in a code fence is the same promise, and harder to spot.
  for (const [, command] of text.matchAll(/`npm (test|lint|ci)`/g)) {
    if (command !== 'ci' && !(command in scripts)) fail(`${where}: quotes "npm ${command}", which package.json does not define`)
  }
}

// ---- every document is listed in the index ----
const index = readFileSync(join(DOCS, 'README.md'), 'utf8')
let tracked = []
try {
  tracked = execFileSync('git', ['ls-files', 'docs'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((file) => file.endsWith('.md'))
    .map((file) => file.replace(/^docs\//, ''))
} catch {
  // No git (a tarball, a container): fall back to what is on disk.
  tracked = readdirSync(DOCS).filter((name) => name.endsWith('.md'))
}

for (const name of tracked) {
  if (name === 'README.md') continue
  if (!index.includes(name)) fail(`docs/${name} exists but is not listed in docs/README.md`)
}
for (const [, href] of index.matchAll(/\]\(([^)\s#]+\.md)\)/g)) {
  if (/^(https?:|\.\.\/)/.test(href)) continue
  if (!existsSync(join(DOCS, href))) fail(`docs/README.md lists ${href}, which does not exist`)
}

// ---- the guide the wiki publishes is real ----
//
// The wiki is a curated reader's guide, not a mirror of the directory: not every document belongs in
// it, but every page it names must be a document that exists, and no two documents may claim one
// page. The engineering pages stay here and are linked from the guide where one is needed.
const wikiPages = new Map()
for (const entry of WIKI_PAGES) {
  if (!existsSync(join(DOCS, entry.file))) {
    fail(`scripts/wiki.mjs names docs/${entry.file}, which does not exist`)
  }
  if (!/^[A-Za-z0-9-]+$/.test(entry.page)) {
    fail(`the wiki page "${entry.page}" is not a single URL token`)
  }
  if (wikiPages.has(entry.page)) fail(`docs/${entry.file} and docs/${wikiPages.get(entry.page)} share the wiki page ${entry.page}`)
  wikiPages.set(entry.page, entry.file)
}

// ---- an operator's page says when it was last run ----
for (const name of ['install.md', 'configure.md', 'tls.md', 'upgrade.md', 'backup.md']) {
  const file = join(DOCS, name)
  if (!existsSync(file)) {
    fail(`docs/${name} is missing: the operator's path in docs/README.md points at it`)
    continue
  }
  if (!/Last (verified|drill)/i.test(readFileSync(file, 'utf8'))) {
    fail(`docs/${name} does not say when it was last verified`)
  }
}

// A directory of markdown that stops being read is a directory that rots: say if it is empty.
if (!statSync(DOCS).isDirectory()) fail('docs/ is not a directory')

if (problems.length) {
  console.error(`The documentation fails ${problems.length} check${problems.length === 1 ? '' : 's'}:`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log(`docs: ${files.length} documents, every link, every listing and every command checked.`)
