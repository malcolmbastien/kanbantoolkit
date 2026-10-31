/**
 * Writing the workspace's words once, for both doors that can.
 *
 * The app's own route and `/api/v1` have the same document, the same revision and the same per-list
 * permissions; the difference is where the credential is checked, not what a change means. Keeping
 * the comparison and the refusal in one module is what stops the two doors drifting apart.
 */

import { NONE_TYPE_ID } from '../../src/domain/board'
import { can, type Action, type Role } from '../../src/domain/roles'
import { grants, type Scope } from '../../src/domain/scopes'
import type { Database } from '../db'
import type { Vocabulary, Workspace } from './types'
import { readWorkspace, readVocabularyRev } from './read'
import {
  canonicalKeyResult,
  canonicalObjective,
  canonicalTemplate,
  parseVocabulary,
  vocabularyObjectivesKnown,
} from './validate'
import { writeVocabulary } from './write'

export const VOCABULARY_ACTIONS: Record<string, Action> = {
  issueTypes: 'board.settings',
  boardTemplates: 'template.manage',
  objectives: 'objective.write',
  keyResults: 'objective.write',
  autoArchiveDays: 'workspace.settings',
}

/** The scope a token must hold to change each list. */
export const VOCABULARY_SCOPES: Record<string, Scope> = {
  issueTypes: 'boards:write',
  boardTemplates: 'boards:write',
  objectives: 'objectives:write',
  keyResults: 'objectives:write',
  autoArchiveDays: 'workspace:admin',
}

export interface VocabularyFailure {
  status: 400 | 403 | 409 | 422 | 503
  code: string
  message: string
  details?: Record<string, unknown>
}

export interface VocabularyWriteOk {
  rev: number
  changed: string[]
  issueTypes: number
  boardTemplates: number
  objectives: number
  keyResults: number
}

export type VocabularyWriteResult = { ok: true; value: VocabularyWriteOk } | { ok: false; failure: VocabularyFailure }

const stable = (value: unknown) => JSON.stringify(value)
const byId = <T extends { id: string }>(list: T[]): T[] => [...list].sort((a, b) => a.id.localeCompare(b.id))

/** The lists a document actually changes, in the order the error names them. */
export function changedVocabulary(before: Workspace, vocabulary: Vocabulary): string[] {
  const changed: string[] = []
  if (stable(byId(before.issueTypes)) !== stable(byId(vocabulary.issueTypes))) changed.push('issueTypes')
  if (stable(byId(before.boardTemplates.map(canonicalTemplate))) !== stable(byId(vocabulary.boardTemplates))) changed.push('boardTemplates')
  if (stable(byId(before.objectives.map(canonicalObjective))) !== stable(byId(vocabulary.objectives))) changed.push('objectives')
  if (stable(byId(before.keyResults.map(canonicalKeyResult))) !== stable(byId(vocabulary.keyResults))) changed.push('keyResults')
  if ((before.autoArchiveDays ?? null) !== (vocabulary.autoArchiveDays ?? null)) changed.push('autoArchiveDays')
  return changed
}

/** The current document, as both a member's GET and the app's own read answer with. */
export async function readVocabulary(db: Database, workspaceId: string) {
  const [state, rev] = await Promise.all([readWorkspace(db, workspaceId), readVocabularyRev(db, workspaceId)])
  return {
    rev,
    issueTypes: state.issueTypes,
    boardTemplates: state.boardTemplates,
    objectives: state.objectives,
    keyResults: state.keyResults,
    ...(state.autoArchiveDays === undefined ? {} : { autoArchiveDays: state.autoArchiveDays }),
  }
}

/**
 * Apply a whole document, or refuse it whole.
 *
 * `scopes` is present only for a token: a session already carries its role, and the role is the
 * ceiling for both. A token must cover the action *and* the person's role must allow it; the first
 * is answered with the missing scope, the second with the list it cannot change.
 */
export async function writeVocabularyDocument(input: {
  db: Database
  workspaceId: string
  role: Role
  scopes?: Scope[]
  body: unknown
}): Promise<VocabularyWriteResult> {
  const body = input.body && typeof input.body === 'object' && !Array.isArray(input.body) ? (input.body as Record<string, unknown>) : null
  if (!body) return { ok: false, failure: { status: 400, code: 'invalid_body', message: 'a JSON document is required' } }

  const rev = body.rev
  if (typeof rev !== 'number' || !Number.isInteger(rev) || rev < 0) {
    return { ok: false, failure: { status: 400, code: 'revision_required', message: 'the revision the vocabulary was based on is required' } }
  }

  const vocabulary = parseVocabulary(body)
  if (!vocabulary) return { ok: false, failure: { status: 400, code: 'invalid_body', message: 'not a workspace vocabulary' } }

  if (!vocabulary.issueTypes.some((type) => type.id === NONE_TYPE_ID) || !vocabulary.issueTypes.some((type) => type.name === 'Initiative')) {
    return {
      ok: false,
      failure: { status: 422, code: 'invalid', message: 'the built-in types cannot be removed', details: { field: 'issueTypes' } },
    }
  }
  if (!vocabularyObjectivesKnown(vocabulary)) {
    return {
      ok: false,
      failure: {
        status: 422,
        code: 'invalid',
        message: 'a key result names an objective that is not in this workspace',
        details: { field: 'keyResults' },
      },
    }
  }

  const current = await readVocabularyRev(input.db, input.workspaceId)
  if (rev !== current) {
    return {
      ok: false,
      failure: {
        status: 409,
        code: 'revision_conflict',
        message: 'the workspace vocabulary has changed since you read it',
        details: { rev: current },
      },
    }
  }

  const before = await readWorkspace(input.db, input.workspaceId)
  const changed = changedVocabulary(before, vocabulary)
  if (changed.length === 0) {
    return {
      ok: true,
      value: {
        rev: current,
        changed: [],
        issueTypes: vocabulary.issueTypes.length,
        boardTemplates: vocabulary.boardTemplates.length,
        objectives: vocabulary.objectives.length,
        keyResults: vocabulary.keyResults.length,
      },
    }
  }

  // A token that cannot reach a list is not asked to guess which list it meant: say which scope is
  // missing. The role is checked beside it, so a token never widens what its owner may do.
  if (input.scopes) {
    const missing = changed.filter((list) => !grants(input.scopes!, VOCABULARY_SCOPES[list]))
    if (missing.length > 0) {
      return {
        ok: false,
        failure: {
          status: 403,
          code: 'scope_required',
          message: `this credential cannot change ${missing.join(', ')}`,
          details: { scope: VOCABULARY_SCOPES[missing[0]], fields: missing },
        },
      }
    }
  }

  const editable = (list: string) => can(input.role, VOCABULARY_ACTIONS[list])
  if (![...new Set(Object.values(VOCABULARY_ACTIONS))].some((action) => can(input.role, action))) {
    return {
      ok: false,
      failure: {
        status: 403,
        code: 'role_forbidden',
        message: `a ${input.role} may not change the workspace's vocabulary`,
      },
    }
  }
  const denied = changed.filter((list) => !editable(list))
  if (denied.length > 0) {
    return {
      ok: false,
      failure: {
        status: 422,
        code: 'invalid',
        message: `a ${input.role} may not change ${denied.join(', ')}`,
        details: { fields: denied },
      },
    }
  }

  await writeVocabulary(input.db, input.workspaceId, vocabulary, current)
  return {
    ok: true,
    value: {
      rev: current + 1,
      changed,
      issueTypes: vocabulary.issueTypes.length,
      boardTemplates: vocabulary.boardTemplates.length,
      objectives: vocabulary.objectives.length,
      keyResults: vocabulary.keyResults.length,
    },
  }
}
