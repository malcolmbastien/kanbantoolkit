import { describe, expect, it } from 'vitest'
import { externalLabelOf, hasExternalLink, safeExternalUrl } from './externalLink'

describe('the external link on a card', () => {
  it('accepts the web, and only the web', () => {
    expect(safeExternalUrl('https://jira.example.com/browse/ATLAS-12')).toBe('https://jira.example.com/browse/ATLAS-12')
    expect(safeExternalUrl('http://wiki.local/page')).toBe('http://wiki.local/page')
    // Trimmed, because a paste carries a newline.
    expect(safeExternalUrl('  https://example.com/x  ')).toBe('https://example.com/x')

    // A card is pressed by a person, so nothing that a browser would execute or resolve locally.
    expect(safeExternalUrl('javascript:alert(1)')).toBeUndefined()
    expect(safeExternalUrl('JavaScript:alert(1)')).toBeUndefined()
    expect(safeExternalUrl('data:text/html,<b>hi</b>')).toBeUndefined()
    expect(safeExternalUrl('file:///etc/passwd')).toBeUndefined()
    expect(safeExternalUrl('/relative/page')).toBeUndefined()
    expect(safeExternalUrl('example.com/page')).toBeUndefined()
    expect(safeExternalUrl('')).toBeUndefined()
    expect(safeExternalUrl(undefined)).toBeUndefined()
  })

  it('says which cards carry a link a reader can press', () => {
    expect(hasExternalLink({ externalUrl: 'https://example.com' })).toBe(true)
    expect(hasExternalLink({})).toBe(false)
    // A value that was stored before the rule, or edited into the database, is not a link.
    expect(hasExternalLink({ externalUrl: 'javascript:alert(1)' })).toBe(false)
  })

  it('shows the label, or the site when there is no label', () => {
    expect(externalLabelOf({ externalLabel: 'ATLAS-12', externalUrl: 'https://jira.example.com/browse/ATLAS-12' })).toBe('ATLAS-12')
    expect(externalLabelOf({ externalLabel: '  ', externalUrl: 'https://jira.example.com/browse/ATLAS-12' })).toBe('jira.example.com')
    expect(externalLabelOf({ externalUrl: 'https://design.example.com/flow' })).toBe('design.example.com')
    expect(externalLabelOf({ externalLabel: 'No address' })).toBeUndefined()
  })
})
