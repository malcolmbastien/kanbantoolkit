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
const changelog = readFileSync(new URL('../site/pages/changelog.html', import.meta.url), 'utf8')
const help = readFileSync(new URL('../site/pages/help.html', import.meta.url), 'utf8')

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

  it('points at the acts themselves for export and closure', () => {
    // R5: a promise that points at a form is a promise nobody keeps. Both anchors exist in the help
    // page the notice links to.
    expect(notice).toContain('href="/help/#export"')
    expect(notice).toContain('href="/help/#closing"')
    expect(help).toContain('id="export"')
    expect(help).toContain('id="closing"')
  })

  it('says what happens to a removed member, in the product’s own words', () => {
    expect(notice).toContain('Former member')
    expect(terms).toContain('isolated from every other workspace')
  })
})

describe('support and changes', () => {
  it('publishes an address and a response expectation', () => {
    for (const page of [notice, terms, help]) {
      expect(page).toMatch(/mailto:support@flowline\.example|mailto:privacy@flowline\.example/)
    }
    expect(help).toContain('within two working')
  })

  it('has a changelog with dated entries, newest first', () => {
    const dates = [...changelog.matchAll(/<time datetime="(\d{4}-\d{2}-\d{2})">/g)].map((match) => match[1])
    expect(dates.length).toBeGreaterThan(0)
    // Newest first: the array is already in document order, so it must equal its own sorted self.
    expect(dates).toEqual([...dates].sort().reverse())
  })
})
