import { describe, expect, it } from 'vitest'
import { inferStage, parseImport, parseJiraCsv, parseTrello, planImport } from './import'
import type { ImportMapping } from './import'
import type { IssueType, User } from './types'

const users: User[] = [
  { id: 'u-riley', name: 'Riley Kim' },
  { id: 'u-maya', name: 'Maya Blake' },
]
const types: IssueType[] = [
  { id: 't-none', name: 'None', color: '#64748b' },
  { id: 't-story', name: 'Story', color: '#0ea5e9' },
  { id: 't-bug', name: 'Bug', color: '#f43f5e' },
  { id: 't-task', name: 'Task', color: '#8b5cf6' },
]
const trello = JSON.stringify({
  name: 'Old Board',
  lists: [
    { id: 'l-todo', name: 'To Do' },
    { id: 'l-doing', name: 'Doing' },
    { id: 'l-done', name: 'Done' },
    { id: 'l-later', name: 'Later' },
  ],
  members: [{ id: 'm-riley', fullName: 'Riley Kim' }],
  cards: [
    {
      id: 'c-1',
      name: 'First imported card',
      desc: 'A body with, a comma.',
      idList: 'l-todo',
      labels: [{ name: 'bug' }],
      idMembers: ['m-riley'],
      dateLastActivity: '2026-10-01T10:00:00Z',
      due: '2026-10-10',
      checklists: [{ checkItems: [{ name: 'A step', state: 'complete' }] }],
    },
    { id: 'c-2', name: 'Second card', idList: 'l-doing' },
    { id: 'c-3', name: 'An old card', idList: 'l-done', closed: true, dateLastActivity: '2026-09-01T10:00:00Z' },
  ],
})

describe('importing a Trello board', () => {
  it('parses lists, people, labels, checklists and dates', () => {
    const parsed = parseTrello(trello)
    expect(parsed.source).toBe('trello')
    expect(parsed.boardName).toBe('Old Board')
    expect(parsed.lists.map((list) => list.name)).toEqual(['To Do', 'Doing', 'Done', 'Later'])
    expect(parsed.people[0]).toMatchObject({ name: 'Riley Kim' })
    expect(parsed.cards[0]).toMatchObject({
      title: 'First imported card',
      labelNames: ['bug'],
      checklist: [{ text: 'A step', done: true }],
      dueDate: '2026-10-10',
    })
  })

  it('plans a split column when two source lists share a stage, and skips archived cards by default', () => {
    const parsed = parseTrello(trello)
    const mapping: ImportMapping = {
      listStages: { 'l-todo': 'backlog', 'l-later': 'backlog', 'l-doing': 'inProgress', 'l-done': 'done' },
    }
    const plan = planImport(parsed, mapping, { types, users, defaultTypeId: 't-story' })
    expect(plan.cards.map((card) => card.title)).toEqual(['First imported card', 'Second card'])
    expect(plan.cards.find((card) => card.title === 'First imported card')?.assigneeIds).toEqual(['u-riley'])
    expect(plan.lanes.find((lane) => lane.key === 'stage:backlog')).toMatchObject({ orientation: 'columns' })
    expect(plan.lanes.filter((lane) => lane.parentKey === 'stage:backlog').map((lane) => lane.name)).toEqual(['To Do', 'Later'])
    expect(plan.tags.map((tag) => tag.name)).toEqual(['bug'])
  })

  it('includes an archived card when asked, with a completion date and a warning', () => {
    const parsed = parseTrello(trello)
    const plan = planImport(
      parsed,
      { listStages: { 'l-done': 'done' } },
      { types, users, defaultTypeId: 't-story', includeArchived: true },
    )
    const old = plan.cards.find((card) => card.title === 'An old card')!
    expect(old.archived).toBe(true)
    expect(old.resolvedAt).toBe(Date.parse('2026-09-01T10:00:00Z'))
    expect(plan.warnings.some((warning) => /no completion date/i.test(warning))).toBe(true)
  })
})

describe('importing a Jira CSV', () => {
  const csv = `Issue key,Summary,Description,Issue Type,Status,Assignee,Labels,Created,Resolved,Due date,Parent
ABC-1,Parent card,"A description, with a comma",Story,In Progress,Riley Kim,bug;urgent,2026-10-01T10:00:00Z,,,
ABC-2,Child card,More,Bug,Done,Maya Blake,,2026-10-02T10:00:00Z,2026-10-03T10:00:00Z,2026-10-10,ABC-1
ABC-3,Other card,,Incident,To Do,,,2026-10-04T10:00:00Z,,,
`

  it('parses quoted fields, statuses, people, types, labels, dates and a parent', () => {
    const parsed = parseJiraCsv(csv)
    expect(parsed.source).toBe('jira')
    expect(parsed.lists.map((list) => list.name)).toEqual(['In Progress', 'Done', 'To Do'])
    expect(parsed.cards).toHaveLength(3)
    expect(parsed.cards[0]).toMatchObject({ title: 'Parent card', description: 'A description, with a comma', typeName: 'Story' })
    expect(parsed.cards[1]).toMatchObject({ parentKey: 'ABC-1', typeName: 'Bug', dueDate: '2026-10-10' })
    expect(parsed.people.map((person) => person.name)).toEqual(['Riley Kim', 'Maya Blake'])
  })

  it('maps types and people, and resolves a parent only when both are imported', () => {
    const parsed = parseJiraCsv(csv)
    const plan = planImport(
      parsed,
      {
        listStages: { 'status-0': 'inProgress', 'status-1': 'done', 'status-2': 'notStarted' },
        types: { Story: 't-story', Bug: 't-bug', Task: 't-task' },
        people: { 'person-riley-kim': 'u-riley', 'person-maya-blake': 'u-maya' },
      },
      { types, users, defaultTypeId: 't-story' },
    )
    expect(plan.cards.map((card) => card.typeId)).toEqual(['t-story', 't-bug', 't-story'])
    expect(plan.cards[1].parentKey).toBe('ABC-1')
    expect(plan.cards[0].assigneeIds).toEqual(['u-riley'])
    expect(plan.cards[0].resolvedAt).toBeUndefined()
  })

  it('leaves an unmatched person unassigned, never creates an account, and defaults the type to None', () => {
    const file = JSON.stringify({
      name: 'People Board',
      lists: [{ id: 'l-todo', name: 'To Do' }],
      members: [{ id: 'm-sam', fullName: 'Sam Lee' }],
      cards: [{ id: 'c-1', name: 'A card', idList: 'l-todo', idMembers: ['m-sam'] }],
    })
    const plan = planImport(
      parseTrello(file),
      { listStages: { 'l-todo': 'notStarted' } },
      { types, users, defaultTypeId: 't-none' },
    )
    expect(plan.cards[0]).toMatchObject({ typeId: 't-none', assigneeIds: [] })
    expect(plan.warnings.some((warning) => /no matching account/i.test(warning))).toBe(true)
  })

  it('None is a choice: a matching name is not assigned against an explicit None', () => {
    const plan = planImport(
      parseTrello(trello),
      { listStages: { 'l-todo': 'backlog' }, people: { 'm-riley': null } },
      { types, users, defaultTypeId: 't-none' },
    )
    expect(plan.cards.find((card) => card.title === 'First imported card')?.assigneeIds).toEqual([])
    expect(plan.warnings.some((warning) => /no matching account/i.test(warning))).toBe(true)
  })

  it('falls back to the default type with a warning, and reads either format automatically', () => {
    const parsed = parseImport(csv)
    const plan = planImport(parsed, { listStages: {} }, { types, users, defaultTypeId: 't-none' })
    expect(plan.warnings.some((warning) => /“Incident” is not an issue type/.test(warning))).toBe(true)
    // A card with no type of its own is None, not the first real card type.
    expect(plan.cards[2].typeId).toBe('t-none')
    expect(parseImport(trello).source).toBe('trello')
  })

  it('refuses a file that is neither export', () => {
    expect(() => parseTrello('{}')).toThrow(/Trello/)
    expect(() => parseJiraCsv('Name,Value\na,b')).toThrow(/Summary/)
  })
})

describe('stage inference', () => {
  it('reads ordinary list names, and leaves the mapping step to correct them', () => {
    expect(inferStage('Backlog')).toBe('backlog')
    expect(inferStage('To Do')).toBe('notStarted')
    expect(inferStage('In Progress')).toBe('inProgress')
    expect(inferStage('In Review')).toBe('inProgress')
    expect(inferStage('Done')).toBe('done')
    expect(inferStage('Closed')).toBe('done')
  })
})
