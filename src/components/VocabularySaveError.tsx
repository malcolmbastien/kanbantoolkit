/**
 * A change to the workspace's words that did not land, said where it was made.
 *
 * Types, templates, objectives and key results are written on the server, and a refusal — a role
 * that may not change this list, a document the server would not take, a workspace whose words
 * somebody else changed — must not look like a save. The local edit stays on screen, because it is
 * still this browser's; the line beside it says that the workspace has not taken it.
 *
 * An error that named a list is shown only beside that list; one that named none is the document's
 * as a whole, and belongs wherever the person was editing.
 */

import { AlertTriangle } from 'lucide-react'
import { useVocabulary } from '../lib/vocabularySync'

export function VocabularySaveError({ lists }: { lists: string[] }) {
  const error = useVocabulary((s) => s.error)
  const field = useVocabulary((s) => s.field)
  if (!error || (field && !lists.includes(field))) return null

  return (
    <p
      role="status"
      data-vocabulary-save-error
      className="mt-1.5 flex items-start gap-1.5 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-meta text-rose-700"
    >
      <AlertTriangle size={12} className="mt-0.5 shrink-0" />
      <span>
        <span className="font-medium">Not saved.</span> {error}
      </span>
    </p>
  )
}
