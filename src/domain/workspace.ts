/**
 * Reading a workspace file back in. Writing is a one-liner the component owns (a JSON
 * download of the persisted slice, plus metadata), but what may be read back is a domain
 * rule: a file is either a complete Kanban Toolkit workspace of a version this build understands,
 * or it is rejected with the reason — an import of a shaped-but-partial file would pretend
 * missing work does not exist.
 */

export interface WorkspaceRead {
  ok: boolean
  /** The human reason a file was refused. Present when ok is false. */
  error?: string
  /** The workspace-shape version the file declares. Present when ok is true. */
  version?: number
  /** The workspace itself, as the app persisted it. Present when ok is true. */
  state?: Record<string, unknown>
}

/** The node types any workspace must carry: the queries below assume they are there. */
const REQUIRED_ARRAYS = ['boards', 'lanes', 'items', 'placements', 'issueTypes'] as const

export function readWorkspaceFile(json: unknown, currentVersion: number): WorkspaceRead {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return { ok: false, error: 'That file is not a Kanban Toolkit workspace.' }
  }
  const file = json as Record<string, unknown>
  if (file.app !== 'kanbantoolkit') return { ok: false, error: 'That file is not a Kanban Toolkit workspace.' }
  const version = file.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: 'The file does not say which workspace shape it was written in.' }
  }
  if (version > currentVersion) {
    return { ok: false, error: `The file was written by a newer Kanban Toolkit — workspace shape ${version}, and this build understands ${currentVersion}.` }
  }
  const state = file.state
  if (typeof state !== 'object' || state === null || Array.isArray(state)) {
    return { ok: false, error: 'The file carries no workspace.' }
  }
  const ws = state as Record<string, unknown>
  const core: { [K in (typeof REQUIRED_ARRAYS)[number]]: unknown[] } = { boards: [], lanes: [], items: [], placements: [], issueTypes: [] }
  for (const key of REQUIRED_ARRAYS) {
    const v = ws[key]
    if (!Array.isArray(v)) {
      return { ok: false, error: `The workspace's ${key} are missing — the file is incomplete, and importing would lose them.` }
    }
    core[key] = v
  }
  if (core.boards.length === 0) {
    return { ok: false, error: 'The workspace has no boards to import.' }
  }
  if (!core.boards.every((b) => typeof (b as { id?: unknown })?.id === 'string' && typeof (b as { name?: unknown })?.name === 'string')) {
    return { ok: false, error: 'A board in the workspace is missing its id or name.' }
  }
  return { ok: true, version, state: ws }
}
