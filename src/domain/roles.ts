/**
 * Who may do what.
 *
 * The matrix lives here and nowhere else. The server asks this function, and the interface asks it
 * to hide or disable a control — but hiding a button is a courtesy, and this is the decision. A
 * second copy of the rules in a component would drift from this one within a release.
 *
 * Roles are a closed set of three and actions are a closed union: adding an action means deciding
 * it for every role, because the matrix is typed as a complete record rather than a list of grants.
 * A missing key would otherwise read as "nobody may", which is the safe answer but a silent one.
 *
 * The matrix is `docs/admin.md` section 3.2. Two rows in it were product decisions and are recorded
 * beside the matrix rather than left to be rediscovered.
 */

/** The three roles, as the wire spells them. Display names are in `ROLES`. */
export type Role = 'viewer' | 'editor' | 'admin'

/**
 * Every distinct thing a person may do.
 *
 * Deliberately coarser than the controls: `item.write` covers a title, a tag and a parent, because
 * they are one act — changing what a card says — and finer actions would be a matrix nobody reads.
 */
export type Action =
  | 'board.read'
  | 'board.search'
  | 'board.create'
  | 'board.design'
  | 'board.settings'
  | 'board.delete'
  | 'item.read'
  | 'item.write'
  | 'item.move'
  | 'item.comment'
  | 'item.attribute'
  | 'item.delete'
  | 'objective.write'
  | 'people.read'
  | 'template.manage'
  | 'workspace.settings'
  | 'workspace.members'
  | 'workspace.share'
  | 'workspace.import'
  | 'workspace.restore'
  // Ending this workspace, and only this one. A workspace is the tenant (task 126): its
  // administrator may close it, and nothing a member does reaches another workspace.
  | 'workspace.delete'

/** Every action, for iteration in tests and for completeness checks. */
export const ACTIONS: readonly Action[] = [
  'board.read',
  'board.search',
  'board.create',
  'board.design',
  'board.settings',
  'board.delete',
  'item.read',
  'item.write',
  'item.move',
  'item.comment',
  'item.attribute',
  'item.delete',
  'objective.write',
  'people.read',
  'template.manage',
  'workspace.settings',
  'workspace.members',
  'workspace.share',
  'workspace.import',
  'workspace.restore',
  'workspace.delete',
]

/**
 * The matrix: one complete record per role, so a new action cannot arrive without a decision.
 *
 * Three rows are worth the argument they cost:
 *
 * - **Board design is Administrator's.** Splitting, renaming and removing lanes can throw away a
 *   column's shape, and everyone watching the board sees it at once. An editor changes the work; an
 *   administrator changes the board the work is read on.
 * - **Attribution is Editor's.** Pointing an initiative at the objective it serves is planning work,
 *   not configuration. Creating or deleting the objective itself is `objective.write`, and that is
 *   the administrator's: a goal is a commitment the organisation makes.
 * - **Moving is its own action.** Dragging a card is arrangement; `item.write` is content. They are
 *   separate in the model (a `Placement` is a record of its own) and they are separate here.
 */
const MATRIX: Record<Role, Record<Action, boolean>> = {
  viewer: {
    'board.read': true,
    'board.search': true,
    'board.create': false,
    'board.design': false,
    'board.settings': false,
    'board.delete': false,
    'item.read': true,
    'item.write': false,
    'item.move': false,
    'item.comment': true,
    'item.attribute': false,
    'item.delete': false,
    'objective.write': false,
    'people.read': true,
    'template.manage': false,
    'workspace.settings': false,
    'workspace.members': false,
    'workspace.share': false,
    'workspace.import': false,
    'workspace.restore': false,
    'workspace.delete': false,
  },
  editor: {
    'board.read': true,
    'board.search': true,
    'board.create': true,
    'board.design': false,
    'board.settings': false,
    'board.delete': false,
    'item.read': true,
    'item.write': true,
    'item.move': true,
    'item.comment': true,
    'item.attribute': true,
    'item.delete': false,
    'objective.write': false,
    'people.read': true,
    'template.manage': false,
    'workspace.settings': false,
    'workspace.members': false,
    'workspace.share': false,
    'workspace.import': false,
    'workspace.restore': false,
    'workspace.delete': false,
  },
  admin: {
    'board.read': true,
    'board.search': true,
    'board.create': true,
    'board.design': true,
    'board.settings': true,
    'board.delete': true,
    'item.read': true,
    'item.write': true,
    'item.move': true,
    'item.comment': true,
    'item.attribute': true,
    'item.delete': true,
    'objective.write': true,
    'people.read': true,
    'template.manage': true,
    'workspace.settings': true,
    'workspace.members': true,
    'workspace.share': true,
    'workspace.import': true,
    'workspace.restore': true,
    'workspace.delete': true,
  },
}

/** What the interface calls each role, and what an invitation says about it. */
export const ROLES: ReadonlyArray<{ id: Role; label: string; description: string }> = [
  {
    id: 'viewer',
    label: 'Viewer',
    description: 'Can read the boards, comment, and search — everything except changing the work.',
  },
  {
    id: 'editor',
    label: 'Editor',
    description: 'Can change the work: cards, initiatives, parents, tags and what they serve.',
  },
  {
    id: 'admin',
    label: 'Administrator',
    description: 'Can change the board itself, and who may come into this workspace.',
  },
]

/**
 * The one decision.
 *
 * An unrecognised role answers false rather than throwing: the caller is usually a middleware
 * reading a database row, and a refusal it can turn into a 403 is worth more than an exception it
 * has to catch.
 */
export function can(role: string, action: Action): boolean {
  const row = MATRIX[role as Role]
  return Boolean(row?.[action])
}
