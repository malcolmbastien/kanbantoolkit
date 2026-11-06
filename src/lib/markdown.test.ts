import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'
import { safeMarkdownUrl } from './richText'

describe('renderMarkdown', () => {
  it('formats the marks the description editor and notes use', () => {
    const html = renderMarkdown('**bold** *italic* `code`\n\n- one\n- two')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<em>italic</em>')
    expect(html).toContain('<code')
    expect(html.match(/<li>/g)).toHaveLength(2)
  })

  it('escapes HTML before formatting it', () => {
    expect(renderMarkdown('<img src=x onerror=alert(1)>')).toContain('&lt;img')
  })

  it('links the web and mail, never a script scheme', () => {
    expect(renderMarkdown('[docs](https://example.com/docs)')).toContain('href="https://example.com/docs"')
    expect(renderMarkdown('[mail](mailto:team@example.com)')).toContain('href="mailto:team@example.com"')

    const unsafe = renderMarkdown('[x](javascript:alert(1))')
    expect(unsafe).not.toContain('href')
    expect(unsafe).toContain('x')
  })
})

describe('safeMarkdownUrl', () => {
  it('fills in https for a bare address and refuses a script scheme', () => {
    expect(safeMarkdownUrl('example.com/docs')).toBe('https://example.com/docs')
    expect(safeMarkdownUrl('mailto:team@example.com')).toBe('mailto:team@example.com')
    expect(safeMarkdownUrl('javascript:alert(1)')).toBeUndefined()
  })
})
