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
  createItem,
  getBoard,
  getItem,
  listBoards,
  listObjectives,
  listPeople,
  moveItem,
  search,
  setParentItem,
  updateItem,
  workspaceSummary,
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
      'One board with its two lane trees — the cards workflow and the initiatives workflow — what is placed in it, and the items on it. This is where the laneIds come from: a move or a create needs the id of a cell, never a lane name.',
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
    name: 'list_people',
    description: 'The people on this instance: id, name and avatar. Use an id here for an assignee; a name is not an id.',
    scope: 'people:read',
    inputSchema: object({}),
    run: (caller) => listPeople(caller),
  },
  {
    name: 'workspace_summary',
    description:
      'What to read before planning: the boards with their item counts, totals for items, initiatives, people and objectives, and the columns of the first team board with how many items each holds. It does not list every card — use search_items or get_board for that.',
    scope: 'boards:read',
    inputSchema: object({}),
    run: (caller) => workspaceSummary(caller),
  },
  {
    name: 'create_item',
    description:
      'Create a card or an initiative on a board, and place it. `typeId` decides which: the Initiative type makes an initiative, which is placed in the initiatives workflow and may not carry a size (its size is the work below it). The lane defaults to the board’s drop cell. `parentId` rolls it up to an initiative. Returns the item with its revision and cell. Refused when the board, lane, type, parent, tag or assignee does not exist, or when the lane belongs to the other workflow.',
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
        size: { type: 'number', description: 'Optional estimate. Refused on an initiative.' },
        priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low'] },
        assignees: { type: 'array', items: { type: 'string' }, description: 'People ids from list_people.' },
        tagIds: { type: 'array', items: { type: 'string' }, description: 'Tags defined on the board.' },
        targetStartDate: { type: 'string', description: 'YYYY-MM-DD.' },
        targetEndDate: { type: 'string', description: 'YYYY-MM-DD.' },
      },
      ['boardId', 'title'],
    ),
    run: (caller, args) => createItem(caller, args),
  },
  {
    name: 'update_item',
    description:
      'Change the fields a person writes: title, description, type, size, priority, assignees, tags, target dates, parent. `baseRev` is required and is the revision from get_item — a revision that has moved is refused with the current item, so read it and decide rather than forcing. An initiative is never retyped and never carries a size; a parent must be an initiative and nothing can be its own ancestor.',
    scope: 'items:write',
    action: 'item.write',
    inputSchema: object(
      {
        itemId: id('The item to change.'),
        baseRev: { type: 'integer', description: 'The revision you read, from get_item.' },
        title: { type: 'string' },
        description: { type: ['string', 'null'] },
        typeId: { type: 'string' },
        size: { type: ['number', 'null'] },
        priority: { type: ['string', 'null'], enum: ['urgent', 'high', 'medium', 'low', null] },
        assignees: { type: 'array', items: { type: 'string' } },
        tagIds: { type: 'array', items: { type: 'string' } },
        targetStartDate: { type: ['string', 'null'], description: 'YYYY-MM-DD or null.' },
        targetEndDate: { type: ['string', 'null'], description: 'YYYY-MM-DD or null.' },
        parentId: { type: ['string', 'null'], description: 'An initiative’s id, or null to detach.' },
      },
      ['itemId', 'baseRev'],
    ),
    run: (caller, args) => {
      const { itemId, ...patch } = args
      return updateItem(caller, String(itemId ?? ''), patch)
    },
  },
  {
    name: 'move_item',
    description:
      'Move a card or an initiative into a cell, at a position. The board’s WIP policy decides: `visualize` lets it through, `justify` refuses with `reason_required` until a reason is given, and `block` refuses with the lane and its limit. A card goes in a cards cell and an initiative in an initiatives cell; an initiative’s move may not cross the section its work derives. A reason, when accepted, is recorded on the card and in its history.',
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
