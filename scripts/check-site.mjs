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
const ORIGIN = (process.env.SITE_URL ?? 'https://flowline.example').replace(/\/+$/, '')
/** The home page's whole transfer: HTML, the stylesheet, and the drawings on it. */
const HOME_BUDGET_KB = 150

const problems = []
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

  for (const [, url] of text.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (url.startsWith('/') || url.startsWith('#')) continue
    if (url.startsWith('mailto:')) continue
    if (url.startsWith(ORIGIN)) continue
    fail(`${where}: requests ${url}, which is not this origin`)
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
