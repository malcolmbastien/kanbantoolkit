// The site, checked as a build rather than as a wish.
//
// Task 151 promises four things a machine can hold it to: every page names itself, no page needs
// JavaScript or a foreign origin to be read, the home page fits in its budget, and what crawlers
// are told matches what is served. This walks `dist/` and fails on the first broken promise.
//
//   node scripts/check-site.mjs
//
// It is a script rather than a unit test because it reads the *build*: the point is the output, and
// an output that only exists after `vite build` cannot be asserted before it.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const DIST = 'dist'
const SITE_DIR = 'site'
const ORIGIN = (process.env.SITE_URL ?? 'https://flowline.example').replace(/\/+$/, '')
/** The home page's whole transfer: HTML, the stylesheet, and the drawings on it. */
const HOME_BUDGET_KB = 150

const problems = []
const escapeHtml = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const fail = (message) => problems.push(message)

/** Every public page in the build, by the file it is served from. */
function pages() {
  const found = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) {
        // `app` and `assets` are the application's, not the site's.
        if (path === join(DIST, 'app') || path === join(DIST, 'assets') || path === join(DIST, '.vite')) continue
        walk(path)
      } else if (name.endsWith('.html')) {
        found.push(path)
      }
    }
  }
  walk(DIST)
  return found.sort()
}

const html = pages()
if (!html.includes(join(DIST, 'index.html'))) fail('no home page at dist/index.html')
if (!html.includes(join(DIST, '404.html'))) fail('no 404 page at dist/404.html')
if (!existsSync(join(DIST, 'app/index.html'))) fail('no app at dist/app/index.html')

const titles = new Map()
const descriptions = new Map()

for (const file of html) {
  const text = readFileSync(file, 'utf8')
  const where = file.replace(`${DIST}/`, '')

  // ---- R4: each page names itself ----
  const title = /<title>([^<]*)<\/title>/.exec(text)?.[1]?.trim()
  if (!title) fail(`${where}: no title`)
  else if (titles.has(title)) fail(`${where}: title "${title}" is also ${titles.get(title)}'s`)
  else titles.set(title, where)

  const description = /<meta name="description" content="([^"]*)"/.exec(text)?.[1]?.trim()
  if (!description) fail(`${where}: no meta description`)
  else if (descriptions.has(description)) fail(`${where}: description duplicated with ${descriptions.get(description)}`)
  else descriptions.set(description, where)
  if (description && description.length > 320) fail(`${where}: description is ${description.length} characters`)

  const canonical = /<link rel="canonical" href="([^"]*)"/.exec(text)?.[1]
  if (!canonical) fail(`${where}: no canonical`)
  else if (!canonical.startsWith(`${ORIGIN}/`) || canonical.includes('//', 8)) {
    fail(`${where}: canonical is not absolute at ${ORIGIN}: ${canonical}`)
  }

  for (const tag of ['og:title', 'og:description', 'og:url', 'twitter:card']) {
    const pattern = new RegExp(`(property|name)="${tag}" content="([^"]*)"`)
    if (!pattern.test(text)) fail(`${where}: no ${tag}`)
  }

  // ---- R3: one nav, one footer, landmarks, a skip link ----
  if (!text.includes('class="skip"')) fail(`${where}: no skip link`)
  for (const landmark of ['<header', '<nav', '<main id="main"', '<footer']) {
    if (!text.includes(landmark)) fail(`${where}: no ${landmark.replace(/[<(]/g, '')} landmark`)
  }
  if (!text.includes('site-nav')) fail(`${where}: no navigation`)
  if (!text.includes('site-footer')) fail(`${where}: no footer`)
  // The skip link has to be the first thing focusable, so nothing may come before it.
  const firstAnchor = text.slice(text.indexOf('<a '))
  if (!firstAnchor.startsWith('<a class="skip"')) fail(`${where}: the skip link is not the first link`)

  // ---- R5/R7: no app bundle, no foreign origin, no script beyond the legacy shim ----
  if (/<script[^>]+src=/.test(text)) fail(`${where}: loads a script`)
  const scripts = [...text.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1])
  if (scripts.length > 1) fail(`${where}: ${scripts.length} inline scripts`)
  if (scripts.some((body) => !body.includes("location.replace('/app'"))) {
    fail(`${where}: an inline script that is not the legacy redirect`)
  }
  if (!/href="\/site\.css"/.test(text)) fail(`${where}: does not load the site stylesheet`)

  // An *asset* may not leave this origin: that is the promise with no cookie banner behind it.
  for (const [, url] of text.matchAll(/<(?:img|script|link|source)\s[^>]*(?:src|href)="([^"]+)"/g)) {
    if (url.startsWith('/') || url.startsWith(ORIGIN)) continue
    fail(`${where}: requests ${url}, which is not this origin`)
  }
  // A *link* may: the source, the licence and the docs live in the repository, and the site points
  // at them rather than copying them (task 164). It must still be a secure address.
  for (const [, url] of text.matchAll(/<a\s[^>]*href="([^"]+)"/g)) {
    if (url.startsWith('/') || url.startsWith('#') || url.startsWith('mailto:')) continue
    if (url.startsWith(ORIGIN) || url.startsWith('https://')) continue
    fail(`${where}: links to ${url}, which is not local and not https`)
  }
}

// ---- R5: the home page's transfer ----
function gz(file) {
  return gzipSync(readFileSync(file)).length
}

const home = readFileSync(join(DIST, 'index.html'), 'utf8')
const referenced = [...home.matchAll(/<img src="([^"]+)"/g)].map((match) => match[1])
const homeFiles = [join(DIST, 'index.html'), join(DIST, 'site.css'), ...referenced.map((url) => join(DIST, url))]
let homeBytes = 0
for (const file of homeFiles) {
  if (!existsSync(file)) fail(`the home page references ${file}, which was not built`)
  else homeBytes += gz(file)
}
const homeKb = homeBytes / 1024
if (homeKb > HOME_BUDGET_KB) fail(`the home page is ${homeKb.toFixed(1)} kB, over ${HOME_BUDGET_KB} kB`)
else console.log(`home page: ${homeKb.toFixed(1)} kB compressed (HTML, CSS and ${referenced.length} image(s))`)

// ---- R2/R3/R6: the home page's copy and its pictures ----
/** What the site may not say: nothing invented, and no superlatives dressed as evidence. */
const BANNED = [
  'trusted by',
  'AI-powered',
  'AI powered',
  '10,000',
  '% of teams',
  'revolutionary',
  'world-class',
  'best-in-class',
  'game-changing',
  'seamless',
  '!',
]

const homePage = readFileSync(join(DIST, 'index.html'), 'utf8')
const productPage = readFileSync(join(DIST, 'product/index.html'), 'utf8')

for (const phrase of BANNED) {
  // An exclamation mark in an attribute or a URL is not copy; the check is over the text.
  const text = homePage.replace(/<[^>]+>/g, ' ')
  if (text.includes(phrase)) fail(`the home page says "${phrase}"`)
}

// One H1, and a heading order that never skips a level.
for (const [name, text] of [
  ['/', homePage],
  ['/product/', productPage],
]) {
  const levels = [...text.matchAll(/<h([1-6])[ >]/g)].map((match) => Number(match[1]))
  const firsts = levels.filter((level) => level === 1).length
  if (firsts !== 1) fail(`${name} has ${firsts} <h1> elements`)
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] > levels[i - 1] + 1) fail(`${name} skips from h${levels[i - 1]} to h${levels[i]}`)
  }
}

// Every picture has alt text and its real dimensions, and is a modern format.
for (const file of html) {
  const text = readFileSync(file, 'utf8')
  const where = file.replace(`${DIST}/`, '')
  for (const [, attributes] of text.matchAll(/<img\s([^>]*)>/g)) {
    if (!/\salt="[^"]+"/.test(attributes)) fail(`${where}: an image has no alt text`)
    if (!/\swidth="\d+"/.test(attributes) || !/\sheight="\d+"/.test(attributes)) {
      fail(`${where}: an image has no explicit width and height`)
    }
    const src = /src="([^"]+)"/.exec(attributes)?.[1] ?? ''
    if (!/\.(webp|avif)$/.test(src)) fail(`${where}: ${src} is not a modern image format`)
    if (!existsSync(join(DIST, src))) fail(`${where}: ${src} was not built`)
  }
}

// The list of "unusual promises" must each point at the page that proves it (R2, the ledger).
const promises = /<h2 id="promises">[\s\S]*?<\/ul>/.exec(homePage)?.[0] ?? ''
if (!promises) fail('the home page has no promises section')
else {
  const items = [...promises.matchAll(/<li>[\s\S]*?<\/li>/g)].map((match) => match[0])
  if (items.length < 3) fail('the promises section lists fewer than three promises')
  for (const item of items) if (!/<a\s[^>]*href="\//.test(item)) fail('a promise has no link to its proof')
}

// The required sections, in the order the page promises (R1).
// The page's own order: the product shot sits beside the claim, and the facts strip runs under
// both of them, which is the layout the home page has (task 152, restyled).
const ORDER = ['product', 'facts', 'ideas', 'starts', 'who', 'promises', 'questions']
const positions = ORDER.map((id) => homePage.indexOf(`id="${id}"`))
if (positions.some((at) => at === -1)) {
  fail(`the home page is missing a section: ${ORDER.filter((id, i) => positions[i] === -1).join(', ')}`)
} else if (positions.join() !== [...positions].sort((a, b) => a - b).join()) {
  fail('the home page is out of order')
}

// ---- R4: both actions are links, and they go where they say ----
if (!/<a[^>]+href="\/app"[^>]*>Open the demo/.test(homePage)) fail('the home page has no demo link to /app')
if (!/<a[^>]+href="\/install\/"[^>]*>Install/.test(homePage)) fail('the home page has no Install link to /install/')

// ---- R1/R4: the site sells nothing, and the three selling pages are gone ----
//
// A price, a plan and a sign-up were the shape of a hosted service (task 164). The site may not
// imply one anywhere — not in a nav item, not in a sentence, not in a leftover link.
const SOLD = ['/pricing', '/signin', '/signup', 'Start free', 'free plan', 'per month', 'per seat', 'subscription']
for (const file of html) {
  const text = readFileSync(file, 'utf8')
  const where = file.replace(`${DIST}/`, '')
  for (const phrase of SOLD) {
    if (text.includes(phrase)) fail(`${where}: still carries "${phrase}"`)
  }
}

// The navigation's second item is Install, and Docs points at the documentation.
const nav = /<nav class="site-nav"[\s\S]*?<\/nav>/.exec(homePage)?.[0] ?? ''
if (!nav) fail('the home page has no main navigation')
else {
  if (!/href="\/install\/"[^>]*>Install</.test(nav)) fail('the navigation has no Install item')
  if (!/href="https:\/\/[^"]+"[^>]*>Docs</.test(nav)) fail('the navigation has no Docs link')
  if (!/href="\/help\/"[^>]*>Help</.test(nav)) fail('the navigation has no Help item')
}

// ---- R1: the licence is decided, written, and named where a person looks (task 165) ----
const licence = existsSync('LICENSE') ? readFileSync('LICENSE', 'utf8') : ''
if (!/GNU AFFERO GENERAL PUBLIC LICENSE/.test(licence) || !/Version 3, 19 November 2007/.test(licence)) {
  fail('LICENSE is not the GNU Affero General Public License, version 3')
}
const declared = JSON.parse(readFileSync('package.json', 'utf8')).license
if (declared !== 'AGPL-3.0-or-later') {
  fail(`package.json declares "${declared}"; the project ships AGPL-3.0-or-later`)
}
const footer = /<footer class="site-footer"[\s\S]*?<\/footer>/.exec(homePage)?.[0] ?? ''
if (!footer.includes('AGPL-3.0')) fail('the footer does not name the licence')
if (!readFileSync(join(DIST, 'install/index.html'), 'utf8').includes('Affero General Public')) {
  fail('the install page does not name the licence')
}

// ---- R2: the project's surface: the documents a contributor and a reporter read ----
for (const document of ['CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md', 'LICENSE']) {
  if (!existsSync(document)) fail(`${document} is missing from the repository root`)
}
const readme = readFileSync('README.md', 'utf8')
for (const link of ['CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md', 'LICENSE', 'docs/']) {
  if (!readme.includes(link)) fail(`the README does not point at ${link}`)
}

// ---- R2: the install page carries the commands, and does not pretend a package exists ----
const install = readFileSync(join(DIST, 'install/index.html'), 'utf8')
// R3: the commands are the ones this repository proves. `docker compose up -d` is what the image job
// in CI runs; the three-command road is what `npm run smoke:node` and the e2e boot. A page that
// quotes a remembered variant of either is a page that fails on the operator's machine.
if (!/<pre><code>[\s\S]*docker compose up -d[\s\S]*<\/code><\/pre>/.test(install)) {
  fail('the install page has no container block with the command CI runs')
}
if (!/<pre><code>[\s\S]*npm ci[\s\S]*npm run build[\s\S]*npm run server[\s\S]*<\/code><\/pre>/.test(install)) {
  fail('the install page has no block with the clone, build and run commands')
}
if (!/npm run backup/.test(install)) fail('the install page does not say how to take a backup')

// R4: the limits are stated, not hidden.
const limits = /<h2 id="limits">[\s\S]*?<\/ul>/.exec(install)?.[0] ?? ''
if (!limits) fail('the install page has no limits section')
else {
  for (const limit of ['SQLite', 'horizontal', 'one process']) {
    if (!limits.includes(limit)) fail(`the install page's limits do not mention "${limit}"`)
  }
}
// R1: the licence is named on the page, and the page says what it asks.
if (!/<h2 id="licence">/.test(install) || !install.includes('Affero General Public')) {
  fail('the install page does not name the licence')
}
if (!install.includes('Git clone') && !/git clone https:\/\//.test(install)) fail('the install page does not say where the code comes from')
if (install.includes('{{repo}}')) fail('the install page still carries the repository placeholder')
// The install page is the short path: it has to send the reader to the docs for the rest (task 167).
for (const doc of ['docs/README.md', 'docs/configure.md', 'docs/tls.md', 'docs/upgrade.md', 'docs/backup.md']) {
  if (!install.includes(doc)) fail(`the install page does not point at ${doc}`)
}

// ---- R5/V5: every internal link resolves to something that was built ----
const resolve = (href) => {
  const path = href.split('#')[0].split('?')[0]
  if (!path || path === '/') return join(DIST, 'index.html')
  const full = join(DIST, path)
  if (existsSync(full) && statSync(full).isFile()) return full
  const index = join(full, 'index.html')
  return existsSync(index) ? index : undefined
}

for (const file of html) {
  const text = readFileSync(file, 'utf8')
  const where = file.replace(`${DIST}/`, '')
  for (const [, href] of text.matchAll(/href="(\/[^"]*)"/g)) {
    if (href.startsWith('/app')) continue
    if (!resolve(href)) fail(`${where}: links to ${href}, which was not built`)
  }
}

// ---- R5: the notice names the processors the deployment is configured with ----
const processors = JSON.parse(readFileSync(join(SITE_DIR, 'processors.json'), 'utf8'))
const notice = readFileSync(join(DIST, 'privacy/index.html'), 'utf8')
for (const processor of processors) {
  if (!notice.includes(escapeHtml(processor.name))) fail(`the privacy notice does not name ${processor.name}`)
}
if (notice.includes('{{processors}}')) fail('the privacy notice still carries the processor placeholder')

// ---- R3: the support address is a link that opens ----
const help = readFileSync(join(DIST, 'help/index.html'), 'utf8')
if (!/href="mailto:support@[^"]+"/.test(help)) fail('the help page has no support mailto:')

// ---- R4: the changelog is dated, newest first ----
const changelog = readFileSync(join(DIST, 'changelog/index.html'), 'utf8')
const dates = [...changelog.matchAll(/<time datetime="(\d{4}-\d{2}-\d{2})">/g)].map((match) => match[1])
if (!dates.length) fail('the changelog has no dated entries')
if (dates.join() !== [...dates].sort().reverse().join()) fail('the changelog is not newest first')

// ---- R6: what machines are told ----
const robots = readFileSync(join(DIST, 'robots.txt'), 'utf8')
for (const expected of ['User-agent: *', 'Allow: /', 'Disallow: /app', `Sitemap: ${ORIGIN}/sitemap.xml`]) {
  if (!robots.includes(expected)) fail(`robots.txt is missing "${expected}"`)
}

const sitemap = readFileSync(join(DIST, 'sitemap.xml'), 'utf8')
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])
if (!locs.length) fail('sitemap.xml lists nothing')
for (const loc of locs) {
  if (!loc.startsWith(`${ORIGIN}/`)) fail(`sitemap.xml has a relative or foreign URL: ${loc}`)
}
if (!/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(sitemap)) fail('sitemap.xml has no lastmod')
if (locs.some((loc) => loc.endsWith('/404.html'))) fail('sitemap.xml lists the 404 page')
for (const file of html) {
  if (file.endsWith('404.html')) continue
  const path = file === join(DIST, 'index.html') ? '/' : `/${file.slice(DIST.length + 1).replace(/index\.html$/, '')}`
  if (!locs.includes(`${ORIGIN}${path}`)) fail(`sitemap.xml is missing ${path}`)
}

// The noindex belongs to the app alone (checked against the headers file, which is the deployment's).
const headers = readFileSync(join(DIST, '_headers'), 'utf8')
if (!/\/app\/\*\n\s+X-Robots-Tag: noindex/.test(headers)) fail('_headers does not scope noindex to /app/*')
const globalBlock = headers.split('\n/app/*')[0]
if (/X-Robots-Tag/.test(globalBlock)) fail('_headers applies noindex to the whole site')

if (problems.length) {
  console.error(`The site fails ${problems.length} check${problems.length === 1 ? '' : 's'}:`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log(`site: ${html.length} pages, all named, self-contained, and inside the budget.`)
