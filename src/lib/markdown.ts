/**
 * Minimal, dependency-free markdown → HTML for the card description preview.
 * Input is escaped first, so the output is safe to inject.
 */
export function renderMarkdown(md: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // Pull fenced code blocks out first so their contents aren't parsed as markdown.
  const blocks: string[] = []
  let text = md.replace(/```([\s\S]*?)```/g, (_m, code: string) => {
    blocks.push(`<pre class="overflow-x-auto rounded bg-slate-100 p-2 text-[11px]"><code>${esc(code.replace(/^\n/, ''))}</code></pre>`)
    return `@@CB${blocks.length - 1}@@`
  })

  text = esc(text)
  text = text.replace(/`([^`]+)`/g, '<code class="rounded bg-slate-100 px-1">$1</code>')
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  text = text.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    '<a class="text-indigo-600 underline" href="$2" target="_blank" rel="noopener">$1</a>',
  )

  const out: string[] = []
  let inUl = false
  let inOl = false
  const closeLists = () => {
    if (inUl) { out.push('</ul>'); inUl = false }
    if (inOl) { out.push('</ol>'); inOl = false }
  }

  for (const line of text.split('\n')) {
    const placeholder = /^@@CB(\d+)@@$/.exec(line)
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    const ul = /^[-*]\s+(.*)$/.exec(line)
    const ol = /^\d+\.\s+(.*)$/.exec(line)

    if (placeholder) {
      closeLists()
      out.push(blocks[Number(placeholder[1])])
    } else if (heading) {
      closeLists()
      const lvl = heading[1].length
      out.push(`<h${lvl} class="mt-2 font-semibold text-slate-800">${heading[2]}</h${lvl}>`)
    } else if (ul) {
      if (!inUl) { closeLists(); out.push('<ul class="list-disc pl-4">'); inUl = true }
      out.push(`<li>${ul[1]}</li>`)
    } else if (ol) {
      if (!inOl) { closeLists(); out.push('<ol class="list-decimal pl-4">'); inOl = true }
      out.push(`<li>${ol[1]}</li>`)
    } else if (line.trim() === '') {
      closeLists()
    } else {
      closeLists()
      out.push(`<p class="mt-1">${line}</p>`)
    }
  }
  closeLists()
  return out.join('\n')
}
