/**
 * The tools an agent is offered (task 170).
 *
 * One table, two transports: the same list is served over Streamable HTTP (`/mcp`) and by the stdio
 * bridge (`server/mcp.ts`), so an agent sees the same vocabulary whichever way it connected. Each
 * tool names one **operation** from `server/operations.ts` — the same one the REST API calls, which
 * is the same one the board uses. A tool may not decide anything of its own; it may only describe.
 *
 * The names are the acts a person has: `move_item`, not `update_placement`; `set_parent`, not
 * `write_edge`. Descriptions say what the tool does, what it refuses and which ids it needs, because
 * the agent reads them and a vague description is a call that will be wrong.
 *
 * **No generative tool exists, and that is a decision, not a gap** (R6). A tool that filled a board
 * with plausible cards would be the app writing what nobody wrote. An agent calling `create_item` is
 * somebody writing; a tool that invented the words would not be.
 */

import type { Action } from '../../src/domain/roles'
import { grants, type Scope } from '../../src/domain/scopes'
import {
  addNote,
  createItem,
  getBoard,
  getItem,
  getVocabulary,
  linkItems,
  listActivity,
  listAttention,
  listBoards,
  listItems,
  listObjectives,
  listPeople,
  mapInitiative,
  moveItem,
  promoteItem,
  search,
  setParentItem,
  unlinkItems,
  updateItem,
  whoami,
  workspaceSummary,
  type AttentionFilters,
  type Op,
  type OpCaller,
} from '../operations'

export interface ToolSpec {
  name: string
  /** For the model: what it does, what it refuses, which ids it needs, what it returns. */
  description: string
  /** The scope a token needs before this tool exists for it. */
  scope: Scope
  /** The matrix action the write needs, so the role is checked as well as the scope. */
  action?: Action
  inputSchema: Record<string, unknown>
  run: (caller: OpCaller, args: Record<string, unknown>) => Promise<Op<unknown>>
}

const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  additionalProperties: false,
  ...(required.length ? { required } : {}),
  properties,
})

const text = (description: string) => ({ type: 'string', description })
const id = (description: string) => ({ type: 'string', description })

export const TOOLS: ToolSpec[] = [
  {
    name: 'whoami',
    description:
      'Who this token speaks for: the person’s id and name, their role, the token’s name, and the scopes it carries. Read it first when a question says "my" or "mine": assignment, authorship and the audit trail all use the person id, not a name. It also says what this credential may not do, which is cheaper than learning it from a refusal.',
    scope: 'items:read',
    inputSchema: object({}),
    run: (caller) => whoami(caller),
  },
  {
    name: 'list_boards',
    description:
      'The boards on this instance: id, name, band (team, program or portfolio), whether it is archived, and how the board enforces WIP. Read this first: every write needs a boardId and a laneId, and this is where to find the board. Paged; a page is 50 by default and never more than 200.',
    scope: 'boards:read',
    inputSchema: object({
      limit: { type: 'integer', description: 'How many boards to return. Default 50, at most 200.' },
      cursor: text('The nextCursor of a previous answer, to continue.'),
    }),
    run: (caller, args) => listBoards(caller, { limit: args.limit, cursor: typeof args.cursor === 'string' ? args.cursor : undefined }),
  },
  {
    name: 'get_board',
    description:
      'One board with its lane trees — one initiatives flow and one or more cards flows, each named — what is placed in it, and the items on it. `workflows` carries the first cards flow and the initiatives flow; `flows` names every flow, with its own `lanes`. This is where the laneIds come from: a move or a create needs the id of a cell, never a lane name.',
    scope: 'boards:read',
    inputSchema: object({ boardId: id('The board, from list_boards.') }, ['boardId']),
    run: (caller, args) => getBoard(caller, String(args.boardId ?? '')),
  },
  {
    name: 'search_items',
    description:
      'Search cards and initiatives by title, the way the app searches: a substring, case-insensitive, not a query language. Archived items are left out. Use it to find an id before an update or a move.',
    scope: 'items:read',
    inputSchema: object({ q: text('What to look for.'), limit: { type: 'integer', description: 'Default 50, at most 200.' } }, ['q']),
    run: (caller, args) => search(caller, String(args.q ?? ''), args.limit),
  },
  {
    name: 'list_items',
    description:
      'Cards and initiatives, filtered and paged — the question a planning agent asks most. Filters: boardId, laneId (a cell and its subtree), typeId, q (the app’s search over titles, descriptions and notes), updatedSince (an ISO instant), assignee (a person id from list_people, or `me`), unassigned, blocked, dueBefore (YYYY-MM-DD) and stage (backlog, notStarted, inProgress, done — one or more, comma-separated; a cell inherits its column’s stage). Archived items are left out unless includeArchived is true. Each item carries its placement, people, due date, priority, block and revision.',
    scope: 'items:read',
    inputSchema: object({
      boardId: id('Only items placed on this board.'),
      laneId: id('Only items in this cell, and the cells under it.'),
      typeId: id('Only items of this type.'),
      q: text('The app’s search over titles, descriptions and notes.'),
      updatedSince: text('ISO timestamp: only items changed after it.'),
      assignee: text('A person id from list_people, or `me` for the token’s owner.'),
      unassigned: { type: 'boolean', description: 'Only items nobody is assigned to.' },
      blocked: { type: 'boolean', description: '`true` for blocked items, `false` for the rest.' },
      dueBefore: text('YYYY-MM-DD: only items promised for that day or earlier.'),
      stage: text('backlog, notStarted, inProgress or done — one, or several comma-separated.'),
      includeArchived: { type: 'boolean', description: 'Include filed-away items.' },
      limit: { type: 'integer', description: 'Default 50, at most 200.' },
      cursor: text('The nextCursor of a previous answer.'),
    }),
    run: (caller, args) => listItems(caller, args as unknown as import('../operations').ItemFilters),
  },
  {
    name: 'list_attention',
    description:
      'The work that needs a look: the same signals the board shows — Blocked, Waiting on, Overdue, Due soon, Late start, Stale, Unowned. The scope is part of the question: omit `boardId` for every board on the instance, send one for that board, and send `assignee: "me"` for the token owner\'s own work. `signal` narrows the rows to one tile, while the counts always describe the scope. A card on more than one board is one row, with every signal its boards raise. Each row carries the item, its board, its column, its age and the signals with the rule\'s own sentence.',
    scope: 'items:read',
    inputSchema: object({
      boardId: id('One board, from list_boards. Omit for every board.'),
      assignee: text('A person id from list_people, or `me` for the token’s owner.'),
      signal: {
        type: 'string',
        enum: ['blocked', 'waiting', 'overdue', 'dueSoon', 'lateStart', 'stale', 'unassigned'],
        description: 'Only rows carrying this signal.',
      },
      limit: { type: 'integer', description: 'Default 50, at most 200.' },
      cursor: text('The nextCursor of a previous answer.'),
    }),
    run: (caller, args) => listAttention(caller, args as unknown as AttentionFilters),
  },
  {
    name: 'get_item',
    description:
      'One card or initiative: its fields, its parent, every board and cell it is placed in, its revision, its rollup (bucket, percent and the counts behind it) and its history. Read it before an update: the revision is what an update must be based on.',
    scope: 'items:read',
    inputSchema: object({ itemId: id('The item, from search_items or get_board.') }, ['itemId']),
    run: (caller, args) => getItem(caller, String(args.itemId ?? '')),
  },
  {
    name: 'list_objectives',
    description:
      'The objectives with the completeness their work gives them — the same rollup the app shows — and their key results. An objective nothing serves has `completeness: null`, which is not 0%: it says the coverage gap rather than a number.',
    scope: 'boards:read',
    inputSchema: object({}),
    run: (caller) => listObjectives(caller),
  },
  {
    name: 'get_vocabulary',
    description:
      'The workspace’s words: its issue types (the ids a new item is made with), board templates, periods, objectives and key results, with the revision the document is at. Read it before creating an item of a particular type, or when a report is about objectives rather than cards.',
    scope: 'boards:read',
    inputSchema: object({}),
    run: (caller) => getVocabulary(caller),
  },
  {
    name: 'list_activity',
    description:
      'The workspace’s event stream, oldest first: a card created, moved, blocked, unblocked, noted or edited, an initiative’s health moving, an objective’s mapping changing. Each event carries `type`, `at` (epoch milliseconds), `itemId`, `actorId` and `data`; a person is an id from list_people. `since` answers "what happened since yesterday?" in one call — read the items themselves for their current state.',
    scope: 'items:read',
    inputSchema: object({
      since: text('ISO timestamp or epoch milliseconds: only events at or after it.'),
      until: text('ISO timestamp or epoch milliseconds: only events at or before it.'),
      type: text('One event type, or a comma-separated list from the webhook contract.'),
      itemId: id('Only events about this item.'),
      limit: { type: 'integer', description: 'Default 50, at most 200.' },
      cursor: text('The nextCursor of a previous answer.'),
    }),
    run: (caller, args) => listActivity(caller, args as unknown as import('../operations').ActivityFilters),
  },
  {
    name: 'list_people',
    description: 'The people on this instance: id, name and avatar. Use an id here for an assignee; a name is not an id.',
    scope: 'people:read',
    inputSchema: object({}),
    run: (caller) => listPeople(caller),
  },
  {
    name: 'workspace_summary',
    description:
      'What to read before planning: the boards with their item counts, totals for items, initiatives, people and objectives, and the cards flows of the first team board with their names and columns. It does not list every card — use search_items or get_board for that.',
    scope: 'boards:read',
    inputSchema: object({}),
    run: (caller) => workspaceSummary(caller),
  },
  {
    name: 'create_item',
    description:
      'Create a card or an initiative on a board, and place it. `typeId` decides which: the Initiative type makes an initiative, which is placed in the initiatives flow; anything else is a card, placed in a cards cell — in any of the board’s cards flows. The lane defaults to the board’s drop cell. `parentId` rolls it up to an initiative. Returns the item with its revision and cell. Refused when the board, lane, type, parent, tag or assignee does not exist, or when the lane belongs to the other kind of flow.',
    scope: 'items:write',
    action: 'item.write',
    inputSchema: object(
      {
        boardId: id('The board to put it on.'),
        title: text('The words a person will read.'),
        typeId: id('The issue type. Omitted uses the board’s card type.'),
        laneId: id('The cell. Omitted uses the board’s drop cell.'),
        description: text('Optional, markdown.'),
        parentId: id('Optional: the initiative this rolls up to.'),
        priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low'] },
        assignees: { type: 'array', items: { type: 'string' }, description: 'People ids from list_people.' },
        tagIds: { type: 'array', items: { type: 'string' }, description: 'Tags defined on the board.' },
        targetStartDate: { type: 'string', description: 'YYYY-MM-DD.' },
        targetEndDate: { type: 'string', description: 'YYYY-MM-DD.' },
        dueDate: { type: 'string', description: 'YYYY-MM-DD — the day the work is promised for.' },
        externalLabel: { type: 'string', description: 'Where the work lives elsewhere: the label the card shows.' },
        externalUrl: { type: 'string', description: 'The address it opens — http or https only.' },
      },
      ['boardId', 'title'],
    ),
    run: (caller, args) => createItem(caller, args),
  },
  {
    name: 'update_item',
    description:
      'Change the fields a person writes: title, description, type, priority, assignees, tags, target dates, due date, external link (label and http/https URL), parent, and a block (with its reason). `baseRev` is required and is the revision from get_item — a revision that has moved is refused with the current item, so read it and decide rather than forcing. An initiative is never retyped; a parent must be an initiative and nothing can be its own ancestor. A card a person has open is refused with 423: read it and report, rather than forcing.',
    scope: 'items:write',
    action: 'item.write',
    inputSchema: object(
      {
        itemId: id('The item to change.'),
        baseRev: { type: 'integer', description: 'The revision you read, from get_item.' },
        title: { type: 'string' },
        description: { type: ['string', 'null'] },
        typeId: { type: 'string' },
        priority: { type: ['string', 'null'], enum: ['urgent', 'high', 'medium', 'low', null] },
        assignees: { type: 'array', items: { type: 'string' } },
        tagIds: { type: 'array', items: { type: 'string' } },
        targetStartDate: { type: ['string', 'null'], description: 'YYYY-MM-DD or null.' },
        targetEndDate: { type: ['string', 'null'], description: 'YYYY-MM-DD or null.' },
        dueDate: { type: ['string', 'null'], description: 'YYYY-MM-DD or null — the day the work is promised for.' },
        externalLabel: { type: ['string', 'null'], description: 'The label the card shows for its link, or null.' },
        externalUrl: { type: ['string', 'null'], description: 'The address the link opens (http or https), or null to clear it.' },
        parentId: { type: ['string', 'null'], description: 'An initiative’s id, or null to detach.' },
        blocked: { type: 'boolean', description: 'Block the item, or clear its block. Prefer block_item/unblock_item.' },
        blockedReason: { type: 'string', description: 'Why it is blocked, when blocking.' },
      },
      ['itemId', 'baseRev'],
    ),
    run: (caller, args) => {
      const { itemId, ...patch } = args
      return updateItem(caller, String(itemId ?? ''), patch)
    },
  },
  {
    name: 'block_item',
    description:
      'Block a card, with the reason a reader will see. A block is its own act, not a field edit: it gets its own history entry and its own `item.blocked` event, and the reason stays on the card. `baseRev` is required, exactly as for update_item. A card a person has open is refused with 423. Use unblock_item to clear it.',
    scope: 'items:write',
    action: 'item.write',
    inputSchema: object(
      {
        itemId: id('The item to block.'),
        baseRev: { type: 'integer', description: 'The revision you read, from get_item.' },
        reason: text('Why it is blocked. Shown on the card and kept in its history.'),
      },
      ['itemId', 'baseRev'],
    ),
    run: (caller, args) =>
      updateItem(caller, String(args.itemId ?? ''), {
        baseRev: args.baseRev,
        blocked: true,
        ...(typeof args.reason === 'string' ? { blockedReason: args.reason } : {}),
      }),
  },
  {
    name: 'unblock_item',
    description:
      'Clear a card’s block and say so in its history. `baseRev` is required, as for block_item. Unblocking takes no reason: the block’s own reason is what the history keeps. Refused with 423 while a person has the card open.',
    scope: 'items:write',
    action: 'item.write',
    inputSchema: object(
      {
        itemId: id('The item to unblock.'),
        baseRev: { type: 'integer', description: 'The revision you read, from get_item.' },
      },
      ['itemId', 'baseRev'],
    ),
    run: (caller, args) => updateItem(caller, String(args.itemId ?? ''), { baseRev: args.baseRev, blocked: false }),
  },
  {
    name: 'move_item',
    description:
      'Move a card or an initiative into a cell, at a position. The board’s WIP policy decides: `visualize` lets it through, `justify` refuses with `reason_required` until a reason is given, and `block` refuses with the lane and its limit. A card goes in a cards cell — in any of the board’s cards flows, and moving between them is a move — and an initiative in an initiatives cell; an initiative’s move may not cross the section its work derives. A reason, when accepted, is recorded on the card and in its history.',
    scope: 'items:write',
    action: 'item.move',
    inputSchema: object(
      {
        boardId: id('The board the cell belongs to.'),
        itemId: id('The item to move.'),
        laneId: id('The cell to move it into, from get_board.'),
        index: { type: 'integer', description: 'Where in the lane: 0 is the top. Omitted puts it at the end.' },
        reason: text('The reason a `justify` lane asks for.'),
        baseRev: { type: 'integer', description: 'Optional: refuse if the item moved since you read it.' },
      },
      ['boardId', 'itemId', 'laneId'],
    ),
    run: (caller, args) => {
      const { boardId, itemId, ...body } = args
      return moveItem(caller, String(boardId ?? ''), String(itemId ?? ''), body)
    },
  },
  {
    name: 'convert_to_initiative',
    description:
      'Turn one card into an initiative on its board. The same item keeps its id, title, people, tags, links, comments, dependencies, parent and history; it wears the Initiative type, records the old type in its history, and moves from its cards-flow cell to the initiatives section of the same stage. Refused for an initiative, an archived card, a portfolio board, a card not on the board, or a board with no initiatives cell.',
    scope: 'items:write',
    action: 'item.write',
    inputSchema: object(
      {
        boardId: id('The board the card is on.'),
        itemId: id('The card to convert.'),
        baseRev: { type: 'integer', description: 'Optional: refuse if the card moved since you read it.' },
      },
      ['boardId', 'itemId'],
    ),
    run: (caller, args) => {
      const { boardId, itemId, ...body } = args
      return promoteItem(caller, String(boardId ?? ''), String(itemId ?? ''), body)
    },
  },
  {
    name: 'set_parent',
    description:
      'Roll an item up to an initiative, or detach it with null. The rule is the app’s: the parent must be an initiative, an item has at most one parent, and nothing can be its own ancestor — a cycle is refused rather than half-applied. Returns the item and its new parent.',
    scope: 'items:write',
    action: 'item.write',
    inputSchema: object(
      {
        itemId: id('The item whose parent changes.'),
        parentId: { type: ['string', 'null'], description: 'The initiative, or null to detach.' },
        baseRev: { type: 'integer', description: 'Optional: refuse if the item moved since you read it.' },
      },
      ['itemId', 'parentId'],
    ),
    run: (caller, args) =>
      setParentItem(caller, String(args.itemId ?? ''), args.parentId === null ? null : String(args.parentId ?? ''), args.baseRev),
  },
  {
    name: 'add_dependency',
    description:
      'Make an item wait on another: "this is not done until that is". A dependency runs across the decomposition, never along it — the domain refuses a self-link, a link to a parent or a descendant, and any link that would close a loop. The relationship is recorded in the dependent item’s history, and its revision moves. Refused with 423 while a person has the dependent item open; a link may still be added to an item nobody has open.',
    scope: 'items:write',
    action: 'item.write',
    inputSchema: object(
      {
        itemId: id('The item that waits.'),
        dependsOn: id('The item it waits on.'),
        reason: text('Optional: why it waits, kept with the link.'),
      },
      ['itemId', 'dependsOn'],
    ),
    run: (caller, args) =>
      linkItems(caller, String(args.itemId ?? ''), {
        dependsOn: args.dependsOn,
        ...(typeof args.reason === 'string' ? { reason: args.reason } : {}),
      }),
  },
  {
    name: 'remove_dependency',
    description:
      'Take a dependency away. The dependent item’s history records that it no longer waits, and its revision moves. Refused with 423 while a person has the dependent item open, and 404 when the two are not linked.',
    scope: 'items:write',
    action: 'item.write',
    inputSchema: object(
      {
        itemId: id('The item that waited.'),
        dependsOn: id('The item it waited on.'),
      },
      ['itemId', 'dependsOn'],
    ),
    run: (caller, args) => unlinkItems(caller, String(args.itemId ?? ''), String(args.dependsOn ?? '')),
  },
  {
    name: 'map_initiative',
    description:
      'Point a strategic initiative at the objective it serves. Only a top-level initiative can serve an objective, and an initiative serves one objective — mapping one that already serves another moves it, in one write. Refused with 423 while a person has the initiative open.',
    scope: 'items:write',
    action: 'item.attribute',
    inputSchema: object(
      {
        objectiveId: id('The objective, from list_objectives.'),
        itemId: id('The top-level initiative.'),
      },
      ['objectiveId', 'itemId'],
    ),
    run: (caller, args) => mapInitiative(caller, String(args.objectiveId ?? ''), String(args.itemId ?? ''), true),
  },
  {
    name: 'unmap_initiative',
    description:
      'Take an initiative off the objective it serves, leaving the initiative in place. Refused with 423 while a person has the initiative open.',
    scope: 'items:write',
    action: 'item.attribute',
    inputSchema: object(
      {
        objectiveId: id('The objective it is mapped to, from list_objectives.'),
        itemId: id('The top-level initiative.'),
      },
      ['objectiveId', 'itemId'],
    ),
    run: (caller, args) => mapInitiative(caller, String(args.objectiveId ?? ''), String(args.itemId ?? ''), false),
  },
  {
    name: 'add_note',
    description:
      'Add a note to an item: a comment in its activity, written as you (the token’s owner), with the mentions its sentence names. Use it to report what you did, ask for a decision, or leave a finding — it is how an agent writes back without changing the plan. It changes no field and takes no revision, so a move by somebody else cannot block it. `text` is required, plain text, 2000 characters at most.',
    scope: 'items:comment',
    action: 'item.comment',
    inputSchema: object(
      {
        itemId: id('The item to add the note to.'),
        text: text('The note. Plain text; `@Name` mentions somebody on this instance.'),
      },
      ['itemId', 'text'],
    ),
    run: (caller, args) => addNote(caller, String(args.itemId ?? ''), { text: args.text }),
  },
]

/** The tools a credential may see: the ones its scopes reach. A read-only token has no write tools
 * at all — not tools that refuse, which would invite an agent to argue with them (R5). */
export function toolsFor(scopes: readonly Scope[]): ToolSpec[] {
  return TOOLS.filter((tool) => grants(scopes, tool.scope))
}

/**
 * The names this table must never contain (R6, V5).
 *
 * A tool that generated cards, rewrote a board from a summary or fabricated history would be the app
 * writing what nobody wrote. The list is spelled out so adding one is a decision somebody has to
 * take in a diff rather than a name that slips in.
 */
export const FORBIDDEN_TOOL_NAMES = ['generate', 'summarise', 'summarize', 'rewrite', 'invent', 'seed', 'populate', 'brainstorm']
