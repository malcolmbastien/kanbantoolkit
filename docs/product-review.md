# Product review

A reading of the product as it stands, and candidates for what could come next. Nothing here is a
commitment. Where a candidate has since been built, its row says so.

## The product in one paragraph

Kanban Toolkit is a team's board and the management reading of the same work. The board is the
team's own: four fixed stages, cards flows it can reshape, WIP limits, a card's history and a
deliberate refusal to invent numbers. The management layer — initiatives, rollups, health,
objectives and key results — is derived from those same cards, so there is no second tracker and no
reporting to maintain. It runs as a static, browser-only workspace or as a self-hosted instance with
accounts, roles, audit, an API and an MCP door.

The strongest idea is the **two altitudes of one dataset**: a card moving in a team's flow changes
the initiative, its section, its percentage and its health with no one entering a status. Features
that deepen that idea fit the product better than generic project-management features.

## What is strong

- **One dataset, two readings.** Rollups, sections, health, progress and the strategy map are all
  derived. A board redesigned on Tuesday still reports its own past on Wednesday.
- **The model is opinionated in useful ways.** Status is the column's stage; an initiative has no
  estimate or status field; a key result is a statement, not a number; mapping is attribution, not
  WIP. These remove whole classes of disagreement.
- **The team's work and the management view share one vocabulary.** Team, program and portfolio
  boards, links that aggregate upward, and multi-flow boards make a real organisational shape
  possible without a second system.
- **Self-hosting is first class.** One Node process, one SQLite file, a Docker image, a Worker entry,
  migrations that refuse a database they cannot read, and a backup procedure.
- **The collaboration foundation is complete enough to build on.** Sessions, invitations, roles,
  item leases, revisions, an offline queue, live updates, audit, API tokens and MCP.
- **The static tier is honest.** No account needed, no tracking, no third-party scripts; the browser
  is the workspace.

## Where it is thin

The board itself is mature. The gaps are mostly at its **edges**:

1. **Bringing work in.** A team with existing work can import a Trello export or a Jira CSV as one board
   ([Importing a board](import.md)). A plain spreadsheet of cards has no import yet (C5), so that team
   builds its board by hand.
2. **Bringing people back.** The inbox now carries a change on a watched card or initiative, an
   assignment, a mention or a due date, and an opt-in plain-text email digest can reach a person who
   is not looking at the board. What is still missing is a push to a chat client or a phone; the
   digest is the only message that leaves the instance.
3. **Letting people read without an account.** Read-only share links were cancelled (task 123);
   today a leader or a stakeholder must be invited as a member to see a board.
4. **Reading dependencies.** Dependencies exist per card, health rolls up "waiting", and the
   boundary band shows external links. There is no map of what depends on what across teams, and
   creating a cross-board link is not a prominent path.
5. **Reviewing the portfolio over time.** Objectives are committed for a period with a window, and
   coverage is visible, but there is no period-over-period review or trend: a period's state is not
   kept when the next one begins.
6. **Using it on a phone.** The static build is not installable and has no offline shell; the board
   is usable but not designed for a phone first.
7. **Technical headroom.** The first download is checked against a size budget in CI (`npm run size`), so
   a new first-download surface needs splitting or a deliberate, recorded increase to the budget.

## Candidate enhancements

### Quick wins — days each

| ID | Idea | Why it is worth doing | Effort |
| --- | --- | --- | --- |
| **Q1** | **Bulk edit priority, tags and target dates.** Add them to the existing multi-select bar. Not built: the bulk bar has move, type, assignee, parent and archive. | Triage is repetitive; the bulk bar already does the harder moves. Small, contained, visible. | S |
| **Q2** | **Search descriptions and notes, not only titles.** Show the matching line in the result. *Built.* | Real cards carry their detail in the body; a title-only search looks broken when the word is in a note. | S–M |
| **Q3** | **Undo a delete.** A short undo window, or a soft-delete that the admin can purge. | Delete is the only irreversible act. Archive has restore; delete has a confirmation and nothing else. | S–M |
| **Q4** | **A keyboard shortcut sheet.** One overlay, opened from the palette and `?`. *Built.* | The keyboard is a first-class path but only discoverable by reading the guide. | S |
| **Q5** | **A board-type change guard.** Warn or refuse a band change when the board carries cards or linked boards, and explain what would be hidden. | Changing team → program/portfolio can hide a cards flow and leave work invisible. The model allows it; the UI should not do it silently. | S |
| **Q6** | **Demo data with more delivery history.** A handful of completed cards over several weeks. | The demo has three deliveries, so the forecast refuses on first visit. The Flow view should show its real answer to a new reader. | S |
| **Q7** | **Installable PWA shell.** A manifest and a service worker caching the app shell. Not built: there is no manifest or service worker yet. | The static tier claims to work anywhere; an installable shell is what makes that usable on a phone. | S–M |

### One cycle — one to three weeks

| ID | Idea | Why it is worth doing | Effort |
| --- | --- | --- | --- |
| **C1** | **Dependencies, end to end.** A cross-board dependency map, plus a proper "link work from another board" picker in the card panel. | The product promises "what depends on what". Today it is per-card links, a health count and a read-only boundary band. No new model is needed — the links and states already exist. | M |
| **C2** | **Comment threads and @mentions** on an item, with the person mentioned in the activity. | Notes are flat and easy to miss. This is the collaboration gap between a board and the chat tool a team already uses. | M |
| **C3** | **Portfolio risk and coverage heatmap.** Objectives by period, the period's window, coverage and the health of the initiatives serving them, in one reading. | The strategy map shows what serves what; a leadership review also needs to see where the risk is concentrated. All derived. | M |
| **C4** | **A period review for OKRs.** Freeze a period's notes and the state of its work, so the next period can be read against the last. | A period has a window but no review record yet. Do not reintroduce a typed percentage or a grade: completeness comes from the work below. | M |
| **C5** | **CSV import with a mapping step.** Board, column, title, type, assignees, dates. A Jira CSV import with a mapping step is built; a generic card spreadsheet is not. | The first day of a real team is a spreadsheet. JSON import is for a whole workspace, not a team arriving with a backlog. | M |
| **C6** | **Outbound webhooks.** Signed events for item created/moved/blocked, initiative health changed, objective mapped. *Built.* | One event layer enables Slack/Teams/CI integrations without building chat. It also gives self-hosters a supported automation seam. | M |
| **C7** | **Backup and restore from Admin**, for an instance administrator. *Built.* | The CLI works, but a self-hoster should not have to read a backup guide to take a copy. Keep restore guarded and explicit. | M |
| **C8** | **The vocabulary on `/api/v1`.** Types, templates, objectives and key results, with the same revision and per-list permissions as the app's own route. *Built.* | Agents and scripts can read the workspace but cannot configure it. The internal document already exists; exposing it is mostly a contract and scope decision. | M |
| **C9** | **Operator observability.** A health answer with schema, queue and live-channel detail, structured request logs, and a way to see recent client errors. | Self-hosters need to tell "the server is down" from "the database is behind" without reading source. | S–M |

### Larger bets — one to two months

| ID | Idea | Why it is worth doing | Effort |
| --- | --- | --- | --- |
| **L1** | **Read-only share links, reconsidered.** A scoped, expiring, revocable link to a board or a portfolio reading, with no account. | This is the original promise — "one clear view for everyone else" — without adding every stakeholder as a member. Task 123 was cancelled; this is a narrower design decision, not a reversal by accident. | M–L |
| **L2** | **An email digest and notifications.** A daily or weekly summary of assigned work, mentions, blocks, due dates and health changes, with per-person preferences. *Built* — in-app watching and an inbox, plus immediate/daily/weekly plain-text email. | Work leaves the board and nothing brings the person back. It reads the outbox C6 built, so it cannot disagree with the board. A chat or phone push is a receiver, not a second event layer. | L |
| **L3** | **Import from Trello or Jira.** A guided mapping of boards, lists/statuses and cards. *Built.* | The biggest acquisition friction is a team's existing board. CSV (C5) is the first step; a named importer is the second. | L |
| **L4** | **Attachments.** First links with a title, then object storage for a self-hosted instance. | Specification, screenshots and contracts live beside the card. It is also a backup and storage decision, not only a UI one. | L |

## If I were choosing three

1. **C1 — dependencies, end to end.** It is the clearest extension of the product's own promise, it
   needs no new data model, and it turns several existing signals (waiting, boundary, blocked) into
   one readable view.
2. **L2 — the digest, built on the webhook layer (C6).** The product is good at showing the truth
   while it is open; the inbox and the digest are what make it part of the week when it is closed.
   Both now exist, and the next step is a receiver that pushes to a chat client or a phone rather
   than another reading of the outbox.
3. **C5 — a card spreadsheet import.** Trello and Jira imports are built (L3). A generic spreadsheet
   import would remove the first-day cost for a team that keeps its work in a sheet.

For immediate value without a project: **Q1, Q3 and Q6** — three small changes that make the existing
product feel more finished.

## Deliberately not suggested

- **Estimates, story points or velocity.** The product counts issues; a second size vocabulary would
  make the rollups disagree with themselves.
- **Individual performance metrics or leaderboards.** They reward the wrong behaviour and punish
  people for the system they work in.
- **AI-written summaries or cards.** The product's rule is that it writes what somebody wrote; a
  model's guess is nobody's words.
- **Real-time chat.** Comments, mentions, webhooks and the inbox/digest cover the need without
  building a second inbox.
- **Multi-workspace tenancy.** One workspace per instance is a deliberate shape; multiple teams live
  as boards inside it.

## A technical note

The event layer behind **C6** exists: items, health and objectives emit into one outbox, webhook
delivery retries from it, and the inbox and digest (**L2**) now read the same outbox. That is why a
watched change, a bell row and an email cannot disagree about what happened. The next integration is
a receiver — chat or phone — rather than a second history. The other constraint is the **bundle
budget**: the first download is checked against 169 KB in CI, so the next first-download feature has
little room. Either keep splitting screens (the templates editor and the Flow screen are the
precedent) or raise the budget deliberately with a recorded reason, but do not let it grow by drift.
