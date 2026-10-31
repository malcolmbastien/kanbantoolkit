import { STAGE_LABELS } from './lanes'
import type { IssueType, Stage, User } from './types'

/**
 * Importing a board from another tool.
 *
 * The parser's job is to make a Trello export or a Jira CSV into a neutral description of what
 * somebody had: lists, cards, people and dates. The planner's job is to ask the one question the
 * source cannot answer — which of our four stages a source status means — and turn that answer into
 * the board design the app already understands.
 *
 * Nothing here writes. The store's `importBoard` creates the board, its flows, lanes, tags and
 * cards in one update, so an import that is cancelled leaves no half-board behind.
 */

export type ImportSource = 'trello' | 'jira'

export interface ParsedList {
  key: string
  name: string
  order: number
}

export interface ParsedPerson {
  key: string
  name: string
  email?: string
}

export interface ParsedChecklist {
  text: string
  done: boolean
}

export interface ParsedCard {
  key: string
  title: string
  description?: string
  listKey: string
  typeName?: string
  assigneeKeys: string[]
  labelNames: string[]
  checklist: ParsedChecklist[]
  createdAt?: number
  resolvedAt?: number
  /** The last activity, used as a date of last resort when the source has no created stamp. */
  lastActivity?: number
  dueDate?: string
  parentKey?: string
  archived?: boolean
}

export interface ParsedImport {
  source: ImportSource
  boardName: string
  lists: ParsedList[]
  cards: ParsedCard[]
  people: ParsedPerson[]
  warnings: string[]
}

/** The answers only a person can give: what a source list means, and who a source person is. */
export interface ImportMapping {
  listStages: Record<string, Stage>
  /** Source type name → an issue type id. A source without types leaves this out. */
  types?: Record<string, string>
  /** Source person key → an existing user id, or null to make a new person. */
  people?: Record<string, string | null>
}

export interface PlanLane {
  key: string
  parentKey: string | null
  name: string
  stage: Stage
  order: number
  orientation?: 'columns' | 'rows'
}

export interface PlanTag {
  key: string
  name: string
}

export interface PlanCard {
  key: string
  title: string
  description?: string
  typeId: string
  laneKey: string
  assigneeIds: string[]
  tagKeys: string[]
  checklist: ParsedChecklist[]
  createdAt: number
  resolvedAt?: number
  dueDate?: string
  parentKey?: string
  archived?: boolean
  sourceKey: string
}

export interface ImportPlan {
  source: ImportSource
  boardName: string
  defaultTypeId: string
  lanes: PlanLane[]
  cards: PlanCard[]
  tags: PlanTag[]
  /** People the import creates because no existing person was chosen. */
  people: User[]
  warnings: string[]
}

const STAGES: Stage[] = ['backlog', 'notStarted', 'inProgress', 'done']

/**
 * What a list or status name probably means, before anybody corrects it.
 *
 * The order matters: "In Progress" contains "progress", and "Done" is checked before the broad
 * "open" family. A terms list is deliberately ordinary — the mapping step is where a team fixes it.
 */
export function inferStage(name: string): Stage {
  const value = name.trim().toLowerCase()
  if (/(done|closed|resolved|complete|released|shipped|merged)/.test(value)) return 'done'
  if (/(progress|doing|active|review|qa|testing|development|building|started)/.test(value)) return 'inProgress'
  if (/(to do|todo|not started|ready|planned|selected|next|open|new)/.test(value)) return 'notStarted'
  return 'backlog'
}

/** A timestamp from the several shapes the two exports use, or undefined rather than a guess. */
function timestamp(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const parsed = Date.parse(value.trim().replace(' ', 'T'))
  return Number.isFinite(parsed) ? parsed : undefined
}

/** A date-only value as the app stores it. */
function dateOnly(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  if (/^\d{4}-\d{2}-\d{2}/.test(value.trim())) return value.trim().slice(0, 10)
  const parsed = timestamp(value)
  return parsed === undefined ? undefined : new Date(parsed).toISOString().slice(0, 10)
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

/** Read a Trello board export. It is the JSON a board's **Export as JSON** produces. */
export function parseTrello(source: string): ParsedImport {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(source) as Record<string, unknown>
  } catch {
    throw new Error('That file is not JSON — choose a Trello board export.')
  }
  if (!raw || !Array.isArray(raw.lists) || !Array.isArray(raw.cards)) {
    throw new Error('That JSON is not a Trello board export: it has no lists and cards.')
  }

  const warnings: string[] = []
  const lists: ParsedList[] = []
  const listIds = new Set<string>()
  for (const [index, value] of list(raw.lists).entries()) {
    const row = value as Record<string, unknown>
    const key = text(row.id)
    if (!key || listIds.has(key)) continue
    if (row.closed === true) {
      warnings.push(`Skipped the closed list “${text(row.name) || key}”.`)
      continue
    }
    listIds.add(key)
    lists.push({ key, name: text(row.name) || `List ${index + 1}`, order: lists.length })
  }

  const people = new Map<string, ParsedPerson>()
  for (const value of list(raw.members)) {
    const row = value as Record<string, unknown>
    const key = text(row.id)
    if (!key) continue
    people.set(key, { key, name: text(row.fullName) || text(row.username) || key })
  }

  const cards: ParsedCard[] = []
  const cardIds = new Set<string>()
  for (const value of list(raw.cards)) {
    const row = value as Record<string, unknown>
    const key = text(row.id)
    const title = text(row.name)
    const listKey = text(row.idList)
    if (!key || !title || !listIds.has(listKey)) {
      if (!title) warnings.push('Skipped a card with no title.')
      continue
    }
    if (cardIds.has(key)) {
      warnings.push(`Skipped a duplicate card id “${key}”.`)
      continue
    }
    cardIds.add(key)

    const labels: string[] = []
    for (const label of list(row.labels)) {
      const name = typeof label === 'string' ? label : text((label as Record<string, unknown>)?.name)
      if (name && !labels.includes(name)) labels.push(name)
    }
    const checklist: ParsedChecklist[] = []
    for (const check of list(row.checklists)) {
      for (const item of list((check as Record<string, unknown>)?.checkItems)) {
        const line = item as Record<string, unknown>
        const label = text(line.name)
        if (label) checklist.push({ text: label, done: line.state === 'complete' })
      }
    }
    const assigneeKeys: string[] = []
    for (const member of list(row.idMembers)) {
      const id = text(member)
      if (!id) continue
      assigneeKeys.push(id)
      if (!people.has(id)) people.set(id, { key: id, name: id })
    }

    const lastActivity = timestamp(row.dateLastActivity)
    cards.push({
      key,
      title,
      description: text(row.desc) || undefined,
      listKey,
      assigneeKeys,
      labelNames: labels,
      checklist,
      ...(lastActivity === undefined ? {} : { lastActivity }),
      ...(dateOnly(row.due) ? { dueDate: dateOnly(row.due) } : {}),
      ...(row.closed === true ? { archived: true } : {}),
    })
  }

  return {
    source: 'trello',
    boardName: text(raw.name) || 'Imported board',
    lists,
    cards,
    people: [...people.values()],
    warnings,
  }
}

/** One CSV field, quotes and doubled quotes and all. */
function parseCsv(source: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"'
        i++
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++
      row.push(field)
      if (row.some((cell) => cell.trim() !== '')) rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  row.push(field)
  if (row.some((cell) => cell.trim() !== '')) rows.push(row)
  return rows
}

/** Read a Jira CSV export. Header names are matched case-insensitively and by common aliases. */
export function parseJiraCsv(source: string): ParsedImport {
  const rows = parseCsv(source)
  if (rows.length < 2) throw new Error('That file has no Jira rows — export a CSV with a header row.')
  const headers = rows[0].map((cell) => cell.trim().toLowerCase())
  const column = (...names: string[]) => headers.findIndex((header) => names.includes(header))
  const keyColumn = column('issue key', 'key', 'id')
  const titleColumn = column('summary', 'title')
  if (titleColumn < 0) throw new Error('That CSV has no Summary column — a Jira export needs one.')

  const descriptionColumn = column('description')
  const typeColumn = column('issue type', 'type')
  const statusColumn = column('status')
  const assigneeColumn = column('assignee', 'assignee name', 'assignee display name')
  const emailColumn = column('assignee email', 'assignee e-mail')
  const labelsColumn = column('labels', 'label')
  const createdColumn = column('created')
  const resolvedColumn = column('resolved')
  const dueColumn = column('due date', 'due')
  const parentColumn = column('parent', 'parent key', 'epic link')

  const warnings: string[] = []
  const lists: ParsedList[] = []
  const listKeys = new Map<string, string>()
  const people = new Map<string, ParsedPerson>()
  const cards: ParsedCard[] = []
  const cardKeys = new Set<string>()

  for (const [index, row] of rows.slice(1).entries()) {
    const value = (columnIndex: number) => (columnIndex < 0 ? '' : (row[columnIndex] ?? '').trim())
    const title = value(titleColumn)
    if (!title) {
      warnings.push(`Skipped row ${index + 2}: it has no summary.`)
      continue
    }
    const status = value(statusColumn) || 'No status'
    if (!listKeys.has(status)) {
      const key = `status-${lists.length}`
      listKeys.set(status, key)
      lists.push({ key, name: status, order: lists.length })
    }
    const assignee = value(assigneeColumn)
    let assigneeKey: string | undefined
    if (assignee) {
      assigneeKey = `person-${assignee.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
      if (!people.has(assigneeKey)) {
        people.set(assigneeKey, { key: assigneeKey, name: assignee, ...(value(emailColumn) ? { email: value(emailColumn) } : {}) })
      }
    }

    let key = value(keyColumn) || `row-${index + 2}`
    if (cardKeys.has(key)) {
      warnings.push(`Skipped duplicate issue key “${key}”.`)
      continue
    }
    cardKeys.add(key)

    const labels = value(labelsColumn)
      .split(/[;,]/)
      .map((label) => label.trim())
      .filter(Boolean)
    cards.push({
      key,
      title,
      description: value(descriptionColumn) || undefined,
      listKey: listKeys.get(status)!,
      ...(value(typeColumn) ? { typeName: value(typeColumn) } : {}),
      assigneeKeys: assigneeKey ? [assigneeKey] : [],
      labelNames: [...new Set(labels)],
      checklist: [],
      ...(timestamp(value(createdColumn)) === undefined ? {} : { createdAt: timestamp(value(createdColumn)) }),
      ...(timestamp(value(resolvedColumn)) === undefined ? {} : { resolvedAt: timestamp(value(resolvedColumn)) }),
      ...(dateOnly(value(dueColumn)) ? { dueDate: dateOnly(value(dueColumn)) } : {}),
      ...(value(parentColumn) ? { parentKey: value(parentColumn) } : {}),
    })
  }

  return { source: 'jira', boardName: 'Jira import', lists, cards, people: [...people.values()], warnings }
}

/** Read either export, or trust the source the person chose. */
export function parseImport(source: string, format?: ImportSource): ParsedImport {
  const kind = format ?? (source.trim().startsWith('{') ? 'trello' : 'jira')
  return kind === 'trello' ? parseTrello(source) : parseJiraCsv(source)
}

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'person'

/**
 * Turn what was parsed into a board design, with the mapping answers applied.
 *
 * The four stages are always present. When two source lists map to the same stage, that column is
 * split into cells named after the lists — the distinction the source had is kept rather than
 * flattened into one column. A card's dates are used as they are; a missing completion date on a
 * done card becomes a warning rather than a silent "now".
 */
export function planImport(
  parsed: ParsedImport,
  mapping: ImportMapping,
  options: { types: IssueType[]; users: User[]; defaultTypeId: string; includeArchived?: boolean; boardName?: string },
): ImportPlan {
  const warnings = [...parsed.warnings]
  const stageOf = new Map<string, Stage>()
  for (const list of parsed.lists) stageOf.set(list.key, mapping.listStages[list.key] ?? inferStage(list.name))

  const byStage = new Map<Stage, ParsedList[]>()
  for (const stage of STAGES) byStage.set(stage, [])
  for (const list of parsed.lists) {
    const stage = stageOf.get(list.key) ?? 'backlog'
    byStage.get(stage)!.push(list)
  }

  const lanes: PlanLane[] = []
  const laneOfList = new Map<string, string>()
  for (const [order, stage] of STAGES.entries()) {
    const lists = byStage.get(stage)!
    const key = `stage:${stage}`
    lanes.push({
      key,
      parentKey: null,
      name: STAGE_LABELS[stage],
      stage,
      order,
      ...(lists.length > 1 ? { orientation: 'columns' as const } : {}),
    })
    if (lists.length <= 1) {
      for (const list of lists) laneOfList.set(list.key, key)
    } else {
      for (const [childOrder, list] of lists.entries()) {
        const childKey = `list:${list.key}`
        lanes.push({ key: childKey, parentKey: key, name: list.name, stage, order: childOrder })
        laneOfList.set(list.key, childKey)
      }
    }
  }

  // People: an explicit choice wins; an exact name match is the sensible default; anything else is
  // a new person, with an id the source cannot collide with.
  const userIdOf = new Map<string, string>()
  const created: User[] = []
  const usedIds = new Set(options.users.map((user) => user.id))
  for (const person of parsed.people) {
    const chosen = mapping.people?.[person.key]
    if (typeof chosen === 'string' && chosen) {
      userIdOf.set(person.key, chosen)
      continue
    }
    if (chosen === undefined) {
      const match = options.users.find((user) => user.name.toLowerCase() === person.name.toLowerCase())
      if (match) {
        userIdOf.set(person.key, match.id)
        continue
      }
    }
    let id = `import-${parsed.source}-${slug(person.key || person.name)}`
    let suffix = 2
    while (usedIds.has(id)) id = `import-${parsed.source}-${slug(person.key || person.name)}-${suffix++}`
    usedIds.add(id)
    created.push({ id, name: person.name })
    userIdOf.set(person.key, id)
  }

  // Types: the chosen id, an exact name, or the board's default. A fallback is a warning, because
  // "everything became a Task" is a fact the importer should say out loud.
  const typeIdOf = (name: string | undefined): string => {
    if (!name) return options.defaultTypeId
    const chosen = mapping.types?.[name]
    if (chosen && options.types.some((type) => type.id === chosen)) return chosen
    const match = options.types.find((type) => type.name.toLowerCase() === name.toLowerCase())
    if (match) return match.id
    warnings.push(`“${name}” is not an issue type here; used the board's default type.`)
    return options.defaultTypeId
  }

  const tags: PlanTag[] = []
  const tagKeys = new Set<string>()
  for (const card of parsed.cards) {
    for (const label of card.labelNames) {
      if (tagKeys.has(label)) continue
      tagKeys.add(label)
      tags.push({ key: label, name: label })
    }
  }

  const included = parsed.cards.filter((card) => options.includeArchived === true || !card.archived)
  const cards: PlanCard[] = []
  for (const card of included) {
    const stage = stageOf.get(card.listKey) ?? 'backlog'
    const laneKey = laneOfList.get(card.listKey) ?? `stage:${stage}`
    const createdAt = card.createdAt ?? card.lastActivity ?? Date.now()
    let resolvedAt = card.resolvedAt
    if (stage === 'done' && resolvedAt === undefined) {
      resolvedAt = card.lastActivity ?? createdAt
      warnings.push(`“${card.title}” is in Done but the source has no completion date; used its last activity.`)
    }
    const assigneeIds: string[] = []
    for (const key of card.assigneeKeys) {
      const id = userIdOf.get(key)
      if (id) assigneeIds.push(id)
      else warnings.push(`“${card.title}” names a person the export did not include.`)
    }
    cards.push({
      key: card.key,
      title: card.title,
      ...(card.description ? { description: card.description } : {}),
      typeId: typeIdOf(card.typeName),
      laneKey,
      assigneeIds: [...new Set(assigneeIds)],
      tagKeys: card.labelNames,
      checklist: card.checklist,
      createdAt,
      ...(resolvedAt === undefined ? {} : { resolvedAt }),
      ...(card.dueDate ? { dueDate: card.dueDate } : {}),
      ...(card.parentKey ? { parentKey: card.parentKey } : {}),
      ...(card.archived ? { archived: true } : {}),
      sourceKey: card.key,
    })
  }

  return {
    source: parsed.source,
    boardName: options.boardName?.trim() || parsed.boardName,
    defaultTypeId: options.defaultTypeId,
    lanes,
    cards,
    tags,
    people: created,
    warnings,
  }
}
