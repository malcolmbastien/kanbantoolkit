/**
 * The notice and the code, held together.
 *
 * A privacy notice that lists a processor the deployment does not use is a false promise; one that
 * omits a processor it uses is a worse one. The list lives in one file — `site/processors.json` —
 * and this file holds it to the things that are true of the code: every row says what it sees, the
 * rows are distinct, and the page renders the list rather than carrying a second copy.
 *
 * Since task 154.1 there is no table of vendors in the code to compare against: an instance's
 * identity provider is the operator's own OIDC issuer, listed as one row.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

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
  it('lists the identity provider as the operator’s own issuer', () => {
    // The one row a deployment's sign-in adds, and the reason there is no vendor table: an instance
    // is configured with an OIDC issuer, whoever runs it.
    expect(PROCESSORS.map((processor) => processor.id)).toContain('oidc')
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

  it('says what happens to a removed member, and which licence the software carries', () => {
    // The notice describes an instance's people because that is what a person reading it will ask
    // about next; the terms carry the licence, which is what actually binds anybody.
    expect(notice).toContain('Former member')
    expect(terms).toContain('AGPL-3.0-or-later')
  })
})

describe('support and changes', () => {
  it('publishes where a question goes, and a response expectation', () => {
    // A link, not a mailbox: the issue tracker is where a question — and a vulnerability — belongs.
    // It is configuration (SUPPORT_URL), so the pages carry the placeholder the build fills rather
    // than a literal.
    for (const page of [notice, terms, layout]) {
      expect(page).toMatch(/href="\{\{(support|security)Url\}\}"/)
      expect(page).not.toMatch(/mailto:/)
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
