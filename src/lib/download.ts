/**
 * Hand a file to the browser. The data is already here — no server exists and none is needed —
 * so this makes a blob, points a temporary anchor at it, and clicks it.
 */
export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.click()
  URL.revokeObjectURL(url)
}
