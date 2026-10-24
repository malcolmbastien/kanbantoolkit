/**
 * The site, emitted into `dist/` beside the app.
 *
 * One file per public page in `site/pages/`, a shared `site/layout.html`, and the site's own
 * stylesheet — no JavaScript, no framework, no request off this origin (task 151). The script's job
 * is deliberately dull: read each page's little metadata block, wrap its body in the layout, write
 * it at its path, then write the files machines read — `sitemap.xml`, `robots.txt` — and the 404.
 *
 * It copies nothing the app already builds. `dist/app/` and `dist/assets/` are Vite's, and the only
 * thing this writes into them is nothing at all.
 *
 *   node scripts/build-site.ts
 */

import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const ROOT = process.cwd()
const SITE = join(ROOT, 'site')
const DIST = join(ROOT, 'dist')

/** The canonical origin: one value for canonicals, Open Graph and the sitemap. */
const ORIGIN = (process.env.SITE_URL ?? 'https://flowline.example').replace(/\/+$/, '')

/**
 * The pages the app used to answer, and the parameters that mean one of them.
 *
 * A link like `/?board=b-atlas` is now a link to the *site*, so the home page carries twenty lines
 * of script that put the visitor where they meant to go — before anything paints. That is the one
 * piece of JavaScript on the site, and it exists so that no link anybody already has breaks.
 */
const APP_PARAMS = [
  'board',
  'view',
  'item',
  'q',
  'filters',
  'lens',
  'boundary',
  'select',
  'collapse',
  'stress',
  'edit',
]

const LEGACY_SHIM = `<script>
      // A link to the old app: /?board=… → /app?board=…. It runs in the head, before first paint,
      // and only when the query names something the app answers.
      (function () {
        var params = ${JSON.stringify(APP_PARAMS)}
        var query = new URLSearchParams(location.search)
        for (var i = 0; i < params.length; i++) {
          if (query.has(params[i])) {
            location.replace('/app' + location.search + location.hash)
            return
          }
        }
      })()
    </script>`

interface Page {
  /** Where it is served, e.g. `/pricing/` or `/404.html`. */
  path: string
  title: string
  description: string
  body: string
}

function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** `<!--\ntitle: …\ndescription: …\npath: …\n-->` above the body, and nothing else to parse. */
function readPage(file: string): Page {
  const source = readFileSync(join(SITE, 'pages', file), 'utf8')
  const match = /^<!--([\s\S]*?)-->/.exec(source)
  if (!match) throw new Error(`${file}: a page needs its metadata comment`)

  const meta: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const [key, ...rest] = line.split(':')
    if (!key?.trim() || !rest.length) continue
    meta[key.trim()] = rest.join(':').trim()
  }

  for (const field of ['title', 'description', 'path']) {
    if (!meta[field]) throw new Error(`${file}: the metadata needs a ${field}`)
  }

  return {
    path: meta.path,
    title: meta.title,
    description: meta.description,
    body: source.slice(match[0].length).trim(),
  }
}

/** A canonical is absolute, always — a relative one is no canonical at all. */
function canonicalOf(path: string): string {
  return `${ORIGIN}${path}`
}

function render(page: Page, layout: string): string {
  const canonical = canonicalOf(page.path)
  const head = page.path === '/' ? LEGACY_SHIM : ''
  return layout
    .replaceAll('{{title}}', escape(page.title))
    .replaceAll('{{description}}', escape(page.description))
    .replaceAll('{{canonical}}', canonical)
    .replaceAll('{{origin}}', ORIGIN)
    .replaceAll('{{content}}', page.body)
    .replaceAll('{{head}}', head)
}

/** Where a page's file goes: `/pricing/` → `dist/pricing/index.html`, `/404.html` as it says. */
function fileFor(path: string): string {
  if (path.endsWith('/')) return join(DIST, path, 'index.html')
  return join(DIST, path)
}

function robots(): string {
  return [
    '# Flowline. The public pages are readable by anybody; the app is not for indexing.',
    'User-agent: *',
    'Allow: /',
    'Disallow: /app',
    'Disallow: /api',
    '',
    `Sitemap: ${ORIGIN}/sitemap.xml`,
    '',
  ].join('\n')
}

function sitemap(pages: Page[]): string {
  const today = new Date().toISOString().slice(0, 10)
  const urls = pages
    .filter((page) => page.path !== '/404.html')
    .map(
      (page) =>
        `  <url>\n    <loc>${canonicalOf(page.path)}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>monthly</changefreq>\n  </url>`,
    )
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n')
}

function main(): void {
  const layout = readFileSync(join(SITE, 'layout.html'), 'utf8')
  const pages = readdirSync(join(SITE, 'pages'))
    .filter((file) => file.endsWith('.html'))
    .sort()
    .map(readPage)

  if (!pages.some((page) => page.path === '/')) throw new Error('the site needs a home page at /')
  if (!pages.some((page) => page.path === '/404.html')) throw new Error('the site needs a 404 page')

  for (const page of pages) {
    const file = fileFor(page.path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, render(page, layout))
  }

  // The site's own assets: one stylesheet, two drawings, and the favicon the app already has.
  cpSync(join(SITE, 'site.css'), join(DIST, 'site.css'))
  for (const asset of readdirSync(join(SITE, 'assets'))) {
    cpSync(join(SITE, 'assets', asset), join(DIST, asset))
  }

  writeFileSync(join(DIST, 'robots.txt'), robots())
  writeFileSync(join(DIST, 'sitemap.xml'), sitemap(pages))

  // A stale page from a previous build would be served forever otherwise.
  for (const stale of ['404.html.tmp']) rmSync(join(DIST, stale), { force: true })

  console.log(`site: ${pages.length} pages, sitemap and robots written to dist/ (${ORIGIN})`)
}

main()
