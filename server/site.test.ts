/**
 * The notice and the code, held together.
 *
 * A privacy notice that lists a processor the deployment does not use is a false promise; one that
 * omits a processor it does use is a worse one. The deployment's providers are configuration, so the
 * only way this can stay true is if the *code* and the *notice* are checked against each other — and
 * that check is this file: add a provider to `server/config.ts` without listing it in
 * `site/processors.json` and it fails, before the page can lie.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { KNOWN } from './config'

interface Processor {
  id: string
  name: string
  sees: string
  role: string
}

const PROCESSORS: Processor[] = JSON.parse(readFileSync(new URL('../site/processors.json', import.meta.url), 'utf8'))

const notice = readFileSync(new URL('../site/pages/privacy.html', import.meta.url), 'utf8')
const terms = readFileSync(new URL('../site/pages/terms.html', import.meta.url), 'utf8')
const layout = readFileSync(new URL('../site/layout.html', import.meta.url), 'utf8')
const security = readFileSync(new URL('../site/pages/security.html', import.meta.url), 'utf8')
const subProcessors = readFileSync(new URL('../site/pages/sub-processors.html', import.meta.url), 'utf8')

describe('the privacy notice', () => {
  it('names every provider this code knows', () => {
    const listed = PROCESSORS.map((processor) => processor.id)
    for (const id of Object.keys(KNOWN)) {
      expect(listed, `site/processors.json is missing "${id}"`).toContain(id)
    }
  })

  it('says what each processor sees, and why it is there', () => {
    for (const processor of PROCESSORS) {
      expect(processor.name.trim().length, processor.id).toBeGreaterThan(0)
      expect(processor.role.trim().length, processor.id).toBeGreaterThan(0)
      expect(processor.sees.trim().length, processor.id).toBeGreaterThan(20)
    }
    // No duplicates: one row per service, not two that disagree.
    expect(new Set(PROCESSORS.map((processor) => processor.id)).size).toBe(PROCESSORS.length)
  })

  it('renders the list from the file, rather than a second copy of it', () => {
    // The page has the placeholder the build fills; the list itself lives in one place.
    expect(notice).toContain('{{processors}}')
  })

  it('points at the act itself for export, and says how a workspace ends', () => {
    // R5: a promise that points at a form is a promise nobody keeps. The site has no help page any
    // more — it was removed on 2026-10-24 — so the notice links the runbook the export restores from,
    // and states the closure in its own words.
    expect(notice).toContain('href="{{repo}}/blob/main/docs/backup.md"')
    expect(notice).toContain('A workspace is deleted')
  })

  it('says what happens to a removed member, in the product’s own words', () => {
    expect(notice).toContain('Former member')
    expect(terms).toContain('isolated from every other workspace')
  })
})

describe('support and changes', () => {
  it('publishes an address and a response expectation', () => {
    // The address is in the footer of every page (the site layout) and on the notice itself; there is
    // no help page to carry it since 2026-10-24.
    // The address is configuration now (SUPPORT_EMAIL / SECURITY_EMAIL), so the pages carry the
    // placeholder the build fills rather than a literal.
    for (const page of [notice, terms, layout]) {
      expect(page).toMatch(/mailto:(\{\{(support|security)Email\}\}|[a-z]+@)/)
    }
    // The sentence wraps in the source; the promise is what matters.
    expect(notice.replace(/\s+/g, ' ')).toContain('within two working days')
  })
})

describe('the trust pages', () => {
  it('lists the processors from one file, not a second copy', () => {
    // The page renders `{{processors}}` at build from `site/processors.json`, which the tests above
    // hold against the code. A hand-written list here would be the copy that drifts.
    expect(subProcessors).toContain('{{processors}}')
    expect(subProcessors).toContain('this demo deployment')
  })

  it('claims nothing it has not been given', () => {
    for (const nonClaim of ['SOC 2', 'ISO 27001', 'penetration-test', 'No uptime target']) {
      expect(security, nonClaim).toContain(nonClaim)
    }
    // And the section that says so is a section, not a sentence buried in praise.
    expect(security).toContain('What is not claimed')
  })

  it('states the accessibility target, its tests and its gaps', () => {
    expect(security).toContain('WCAG 2.2 level AA')
    expect(security).toContain('Known gaps')
    expect(security).toContain('screen-reader audit')
  })

  it('names the licence on the security page rather than a page of its own', () => {
    expect(security).toContain('Affero General Public')
    expect(security).toContain('blob/main/LICENSE')
  })
})
