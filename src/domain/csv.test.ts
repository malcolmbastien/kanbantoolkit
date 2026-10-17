import { describe, expect, it } from 'vitest'
import { boardCsv, BOARD_CSV_HEADER, csvField, csvFilename, dashboardCsv, toCsv } from './csv'
import { blockedBelow, rollupOf, type Graph } from './derive'
import { boardInitiatives, buildRefs, initiativeTypeById, tagsOf } from './board'
import { initiativeHealth } from './health'
import { HEALTH_META } from './health'
import { createFixture } from './fixture'

/**
 * A minimal RFC 4180 reader, written out here rather than shared with the writer: a round-trip
 * test that used the same code for both directions would only prove it is consistent with itself.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c !== '"') field += c
      else if (text[i + 1] === '"') {
        field += '"'
        i += 1
      } else quoted = false
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (c !== '\r') field += c
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

const seed = createFixture()
const graph: Graph = { items: seed.items, edges: seed.edges, links: seed.links, placements: seed.placements, lanes: seed.lanes }

describe('csv', () => {
  it('quotes a field only when it has to, and doubles its quotes', () => {
    expect(csvField('plain')).toBe('plain')
    expect(csvField(7)).toBe('7')
    expect(csvField(undefined)).toBe('')
    expect(csvField(null)).toBe('')
    expect(csvField('a, b')).toBe('"a, b"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField('one\ntwo')).toBe('"one\ntwo"')
    expect(csvField('one\r\ntwo')).toBe('"one\r\ntwo"')
  })

  it('a title with commas, quotes and newlines survives a round trip, unicode and all', () => {
    const titles = ['Fix the thing, properly', 'Say "done" when done', 'First line\nSecond line', 'Änderung: Größe — 尺寸 ✓']
    const text = toCsv([['Title'], ...titles.map((t) => [t])])
    expect(parseCsv(text)).toEqual([['Title'], ...titles.map((t) => [t])])
    // CRLF between rows and one at the end, as the format asks.
    expect(text.endsWith('\r\n')).toBe(true)
    expect(text).not.toContain('\n\n')
  })

  it('nothing to write is nothing, not a stray newline', () => {
    expect(toCsv([])).toBe('')
    expect(toCsv([['Ref', 'Title']])).toBe('Ref,Title\r\n')
  })

  it('writes the board\'s cards in board order, with the lane path and the stage', () => {
    const text = boardCsv('b-atlas', graph, seed.issueTypes, seed.users)
    const rows = parseCsv(text)
    expect(rows[0]).toEqual(BOARD_CSV_HEADER)

    // The seeded Atlas board carries five live cards, column by column.
    expect(rows.length).toBe(6)
    const titles = rows.slice(1).map((r) => r[1])
    expect(titles).toEqual(['Email verification', 'Build signup form', 'SSO buttons', 'Signup validation on retry', 'Design signup screens'])

    const form = rows.find((r) => r[1] === 'Build signup form')!
    expect(form[0]).toBe('USER2') // ref
    expect(form[2]).toBe('User Story')
    expect(form[3]).toBe('In Progress / Dev') // the cell's full path, not just its own name
    expect(form[4]).toBe('In Progress') // and the stage, which a rename cannot change
    expect(form[5]).toBe('Riley Kim; Maya Blake') // joined with semicolons: a name may hold a comma
    expect(form[6]).toBe('no')
    expect(form[10]).toBe('New signup flow') // the parent, by title

    const sso = rows.find((r) => r[1] === 'SSO buttons')!
    expect(sso[6]).toBe('yes')
    expect(sso[7]).toBe('Gateway contract not ready')

    // Archived cards are off the board, so they are not in the file.
    expect(titles).not.toContain('Import legacy accounts')
    expect(titles).not.toContain('Export the register as CSV')
  })

  it('a board with no cards is a header and nothing else', () => {
    const rows = parseCsv(boardCsv('b-strategy', graph, seed.issueTypes, seed.users))
    expect(rows).toEqual([BOARD_CSV_HEADER])
  })

  it('writes the dashboard\'s initiative rows, the same numbers the table shows', () => {
    const initiatives = boardInitiatives(graph, 'b-atlas', seed.issueTypes)
    const rows = initiatives.map((item) => ({
      item,
      roll: rollupOf(item.id, graph),
      blocked: blockedBelow(item.id, graph),
      overdue: false,
      health: initiativeHealth(item.id, graph),
      kind: initiativeTypeById(seed.boards, item.initiativeTypeId)?.name ?? 'None',
      tags: tagsOf(seed.boards, item).map((t) => t.name).join('; '),
    }))
    const parsed = parseCsv(dashboardCsv(rows, seed.items, seed.issueTypes))
    expect(parsed[0][1]).toBe('Initiative')
    const signup = parsed.find((r) => r[1] === 'New signup flow')!
    const roll = rollupOf('init-signup', graph)
    expect(signup[2]).toBe('Initiative')
    expect(signup[3]).toBe('None') // the fixture's initiatives carry no kind
    expect(signup[4]).toBe(String(roll.percent))
    expect(signup[5]).toBe(String(roll.done))
    expect(signup[6]).toBe(String(roll.total))
    expect(signup[8]).toBe(String(roll.size)) // cumulative size, beside the counts it sits with
    expect(signup[11]).toBe('In Progress')
    expect(signup[12]).toBe('no') // overdue
    expect(signup[13]).toBe(String(blockedBelow('init-signup', graph)))
    // Health is part of the row now, so the file and the table cannot disagree about it.
    const health = initiativeHealth('init-signup', graph)
    expect(signup[14]).toBe(HEALTH_META[health.level].label)
    expect(signup[15]).toBe(health.flags.map((f) => f.label).join('; '))
  })

  it('names the file after the board, without punctuation a filesystem minds', () => {
    expect(csvFilename('Team Atlas', 'cards')).toBe('team-atlas-cards.csv')
    expect(csvFilename('R&D / Ops (2026)', 'initiatives')).toBe('r-d-ops-2026-initiatives.csv')
    expect(csvFilename('   ', 'cards')).toBe('flowline-cards.csv')
  })

  it('the dashboard export and the board export are different shapes on purpose', () => {
    const board = parseCsv(boardCsv('b-atlas', graph, seed.issueTypes, seed.users))
    const dash = parseCsv(
      dashboardCsv(
        boardInitiatives(graph, 'b-atlas', seed.issueTypes).map((item) => ({
          item,
          roll: rollupOf(item.id, graph),
          blocked: 0,
          overdue: false,
          health: initiativeHealth(item.id, graph),
          kind: 'None',
          tags: '',
        })),
        seed.items,
        seed.issueTypes,
      ),
    )
    // A card file answers "what is in each column"; an initiative file answers "how is each
    // initiative doing". The only thing they share is the ref that links them.
    expect(board[0]).toContain('Column')
    expect(dash[0]).not.toContain('Column')
    expect(board[0]).toContain('Ref')
    expect(dash[0]).toContain('Ref')
    expect(buildRefs(seed.items, seed.issueTypes).get('init-signup')).toBe(dash[1][0])
  })
})
