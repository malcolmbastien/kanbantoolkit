#!/usr/bin/env node
/**
 * The documentation wiki, rendered from `docs/`.
 *
 * The repository's `docs/` directory is the source: it is reviewed with the code, checked by
 * `npm run docs:check`, and it is the version a person who clones the repository has. The GitHub
 * wiki is a *browsable copy* of those pages — the same content with a sidebar and a search box —
 * so it is generated, never edited. A page that is written in two places drifts, and the copy is
 * the one that rots; a generator cannot drift from its input.
 *
 *   npm run docs:wiki              publish the wiki (clone, render, commit, push)
 *   npm run docs:wiki -- --dry-run render into node_modules/.tmp/wiki-preview and stop
 *
 * GitHub creates a wiki's git repository only when its first page is saved in the browser, so a
 * repository whose wiki has never been opened fails the clone with "Repository not found". The
 * message says what to click; after that this command owns the wiki.
 *
 * Links are rewritten, not copied: a page in the wiki is a page name, an image is a raw URL on the
 * main repository, and anything else is a blob URL. The rewrite refuses to leave a relative link
 * behind, which is the one failure a browser would show and a commit would not.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { SECTION_TITLES, WIKI_PAGES } from './wiki.mjs'

const ROOT = process.cwd()
const DOCS = join(ROOT, 'docs')
const WORK = join(ROOT, 'node_modules', '.tmp', 'wiki')
const PREVIEW = join(ROOT, 'node_modules', '.tmp', 'wiki-preview')
const dryRun = process.argv.includes('--dry-run')

const run = (command, args, options = {}) =>
  execFileSync(command, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim()

/** A git setting, or nothing when it is unset — `git config` exits non-zero for a missing key. */
const configValue = (key) => {
  try {
    return run('git', ['config', key])
  } catch {
    return ''
  }
}

/** `owner/repo`, from the remote this checkout pushes to. A fork publishes to its own wiki. */
function slugOf() {
  if (process.env.WIKI_REPO) return process.env.WIKI_REPO
  const url = run('git', ['remote', 'get-url', 'origin'])
  const match = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (!match) throw new Error(`The origin is not a GitHub repository: ${url}`)
  return `${match[1]}/${match[2]}`
}

const slug = slugOf()
const BLOB = `https://github.com/${slug}/blob/main`
const RAW = `https://raw.githubusercontent.com/${slug}/main`
const WIKI_URL = `https://github.com/${slug}.wiki.git`
const WIKI_PAGE_URL = `https://github.com/${slug}/wiki`

const pageOf = new Map(WIKI_PAGES.map((entry) => [entry.file, entry.page]))
const pages = new Set(WIKI_PAGES.map((entry) => entry.page))

/** The one-line replacement for a link target. Throws rather than write a link that would 404. */
function rewriteTarget(target, source) {
  if (/^(https?:|mailto:|tel:|data:|#)/.test(target)) return target

  const hash = target.indexOf('#')
  const fragment = hash >= 0 ? target.slice(hash) : ''
  const plain = hash >= 0 ? target.slice(0, hash) : target
  const pathname = plain.split('?')[0]
  if (!pathname) return target

  const absolute = resolve(dirname(source), decodeURIComponent(pathname))
  if (!existsSync(absolute)) {
    throw new Error(`${relative(ROOT, source)} links to ${target}, which does not exist`)
  }

  const fromDocs = relative(DOCS, absolute).split(sep).join('/')
  const mapped = fromDocs.endsWith('.md') && !fromDocs.startsWith('../') ? pageOf.get(fromDocs) : undefined
  if (mapped) return `${mapped}${fragment}`

  const repoPath = relative(ROOT, absolute).split(sep).join('/')
  const base = /\.(png|jpe?g|gif|svg|webp|avif)$/i.test(absolute) ? RAW : BLOB
  return `${base}/${repoPath}${fragment}`
}

/** A page as the wiki takes it: same words, links that resolve inside the wiki. */
function render(text, source) {
  // Images first: their alt text is not a label, and a relative source would 404 in the wiki.
  const withImages = text.replace(
    /(!\[[^\]]*\]\()([^)\s]+)((?:[^)]*)\))/g,
    (_, open, target, rest) => open + rewriteTarget(target, source) + rest,
  )

  // A link whose label is the file name it points at reads as a file path in a wiki; the page's own
  // name is what a wiki calls it. Prose labels ("the REST API") are left alone.
  const rewritten = withImages
    .replace(/(?<!!)\[([^\]]+)\]\(([^)\s]+)((?:[^)]*)\))/g, (_, label, target, rest) => {
      const next = rewriteTarget(target, source)
      const absolute = resolve(dirname(source), decodeURIComponent(target.split('#')[0].split('/').pop()))
      const page = pageOf.get(relative(DOCS, absolute).split(sep).join('/'))
      const file = target.split('#')[0]
      const tidy = page && (label === file || label === `docs/${file}`) ? page : label
      return `[${tidy}](${next}${rest}`
    })
    .replace(/(<img\b[^>]*\bsrc=")([^"]+)(")/g, (_, open, target, close) => open + rewriteTarget(target, source) + close)
    .replace(/(<a\b[^>]*\bhref=")([^"]+)(")/g, (_, open, target, close) => open + rewriteTarget(target, source) + close)

  // Belt and braces: a relative link left behind opens a 404 in the wiki and nowhere else.
  for (const [, target] of rewritten.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(https?:|mailto:|tel:|#)/.test(target)) continue
    const bare = target.split('#')[0]
    if (pages.has(bare)) continue
    throw new Error(`${relative(ROOT, source)} would leave the relative link ${target} in the wiki`)
  }

  return rewritten
}

/** The hub: using the application, then installing and running it. */
function home() {
  const table = (section) =>
    WIKI_PAGES.filter((entry) => entry.section === section)
      .map((entry) => `| **[${entry.page}](${entry.page})** | ${entry.note} |`)
      .join('\n')

  return `# Kanban Toolkit guide

An open-source Kanban board for a team’s flow and for the wider view that management makes of the same
work — on a machine you own.

**The site and the demo:** https://kanbantoolkit.com

This guide is generated from [\`docs/\`](${BLOB}/docs) in the repository by \`npm run docs:wiki\`. The
files there are the source, and the version that ships with the code — **edit those, never these
pages.**

## ${SECTION_TITLES.use}

| | |
| --- | --- |
${table('use')}

## ${SECTION_TITLES.run}

| | |
| --- | --- |
${table('run')}
`
}

function sidebar() {
  const links = (section) =>
    WIKI_PAGES.filter((entry) => entry.section === section)
      .map((entry) => `- [${entry.page}](${entry.page})`)
      .join('\n')

  return `### Kanban Toolkit

[Home](Home)

**${SECTION_TITLES.use}**
${links('use')}

**${SECTION_TITLES.run}**
${links('run')}
`
}

const footer = `---
Generated from [\`docs/\`](${BLOB}/docs) in the repository by \`npm run docs:wiki\`. Edit the source, not this page.
`

/** Write the whole wiki into a directory, and say what was written. */
function renderInto(directory) {
  mkdirSync(directory, { recursive: true })
  for (const name of readdirSync(directory)) {
    if (name.endsWith('.md')) rmSync(join(directory, name))
  }

  writeFileSync(join(directory, 'Home.md'), home())
  writeFileSync(join(directory, '_Sidebar.md'), sidebar())
  writeFileSync(join(directory, '_Footer.md'), footer)

  const written = ['Home', '_Sidebar', '_Footer']
  for (const entry of WIKI_PAGES) {
    const source = join(DOCS, entry.file)
    writeFileSync(join(directory, `${entry.page}.md`), render(readFileSync(source, 'utf8'), source))
    written.push(entry.page)
  }
  return written
}

if (dryRun) {
  const written = renderInto(PREVIEW)
  console.log(`wiki: ${written.length} pages rendered into ${relative(ROOT, PREVIEW)} (nothing published)`)
  console.log(written.join(', '))
  process.exit(0)
}

// The wiki publishes the documentation as committed. A page that exists only in somebody's working
// tree is not what a reader of the repository can see, and putting it on a public wiki would publish
// work that is still being written. `--dry-run` is the way to look at that work first.
const dirtyDocs = run('git', ['status', '--porcelain', '--', 'docs'])
if (dirtyDocs) {
  console.error('The wiki publishes the committed documentation, and docs/ has changes that are not committed:')
  for (const line of dirtyDocs.split('\n')) console.error(`  ${line}`)
  console.error('Commit them first, or preview them with `npm run docs:wiki -- --dry-run`.')
  process.exit(1)
}

// ---- publish ----
let clone = false
if (!existsSync(join(WORK, '.git'))) {
  mkdirSync(dirname(WORK), { recursive: true })
  clone = true
}

try {
  if (clone) {
    run('git', ['clone', '--quiet', WIKI_URL, WORK])
  } else {
    // The wiki is generated, so a hand edit is not merged — it is replaced, which the footer says.
    run('git', ['-C', WORK, 'fetch', '--quiet', 'origin'])
    run('git', ['-C', WORK, 'reset', '--hard', '@{u}'])
  }
} catch (error) {
  // The first page is what makes GitHub create the wiki's repository; until then the clone says
  // only that the repository is not there, which is not a useful sentence on its own.
  const detail =
    error && typeof error === 'object' && 'stderr' in error && error.stderr
      ? String(error.stderr).trim().split('\n').pop()
      : error instanceof Error
        ? error.message.split('\n')[0]
        : String(error)
  console.error(`The wiki is not published: its repository could not be reached.`)
  if (detail) console.error(`  ${detail}`)
  console.error(`GitHub creates a wiki's repository when its first page is saved, so open`)
  console.error(`  ${WIKI_PAGE_URL}`)
  console.error(`choose "Create the first page", save it, and run this command again. Its content will be replaced.`)
  process.exit(1)
}

const written = renderInto(WORK)
run('git', ['-C', WORK, 'add', '--all'])

const changed = run('git', ['-C', WORK, 'status', '--porcelain'])
if (!changed) {
  console.log(`wiki: ${written.length} pages already match the repository; nothing to publish`)
  process.exit(0)
}

const name = configValue('user.name') || 'Kanban Toolkit'
const email = configValue('user.email') || 'noreply@github.com'
const sha = run('git', ['rev-parse', '--short', 'HEAD'])

run('git', ['-C', WORK, '-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '--quiet', '-m', `Docs: publish from ${sha}`])
run('git', ['-C', WORK, 'push', '--quiet'])

console.log(`wiki: ${written.length} pages published to ${WIKI_PAGE_URL.replace('https://github.com/', '')}`)
