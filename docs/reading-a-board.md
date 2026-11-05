# Reading a board

A board has columns, one or more cards flows, initiatives that roll work up, a side drawer for the
detail, and a boundary for work that lives somewhere else. This page explains what each part shows.

<img src="img/guide/board-overview.webp" alt="The Team Atlas board with its initiatives flow above the Cards flow, and the four typed columns in each" width="1100">

*The two altitudes on one board: the initiatives flow above, the team's Cards flow beneath, both
using Backlog, Not Started, In Progress and Done.*

## The four top-level columns

Every flow has the same four top-level columns, and they are fixed:

| Column | Stage | What it means |
| --- | --- | --- |
| **Backlog** | `backlog` | Work that is not committed yet. |
| **Not Started** | `notStarted` | Work the team has committed to but not begun. |
| **In Progress** | `inProgress` | Work somebody has started. |
| **Done** | `done` | Work that is finished. |

The column is the card's status. There is no separate status field to keep in step: moving a card
into a column is what changes its stage, and a card that leaves Done is open again. The same four
stages are the sections of the initiatives flow, so a card and the outcome above it are read in the
same vocabulary.

A column can be **split** into named cells, arranged in columns or rows. Every cell stays in the
stage of the column it came from, so a split makes the board more precise without inventing a fifth
stage. The top-level columns themselves are not added, removed or reordered.

## Level of detail

Every board has a **Detail** dial in its secondary bar, beside **Archive done**, **Export CSV** and
**Filters**: **Mini → Summary → Full**.

- **Full** is the card described on this page — every field, badge and control.
- **Summary** keeps the title, type, due date and people, and keeps the blocked and warning markers.
  The description, tags, checklist, links, parent, age, priority and counts are not drawn.
- **Mini** draws each item as a small colour tile in a wrapping grid: the type's colour, a red marker
  when the card is blocked, and an amber marker when it has a warning. The title, type and warnings
  are in the tile's tooltip and accessible name.

The level changes only the drawing. The same items are in the same cells, with the same counts, WIP,
filters, search, focus, selection, drag, card menu and keyboard moves. It is remembered in this
browser per board, not in the workspace, so two people may read one board differently and a shared
link opens the reader's own choice. It is not a permission — a Viewer gets it too. **Board design
mode** always draws Full and disables the dial; Save or Cancel returns to the chosen level.

## Multiple cards workflows

A board has exactly **one initiatives flow** and **one or more cards flows**.

- Each cards flow is its own set of the four columns, with its own name, its own WIP limits and its
  own place in the stack. The flows are drawn as bands, one below another, not as tabs. Two columns
  named Backlog can then be seen to mean different things.
- A card belongs to exactly one cards flow. Dragging it into another flow is a move: the target
  flow's columns and WIP limits apply, and the card keeps its identity and history.
- **Edit board** is where a cards flow is added, renamed, reordered or removed. A flow can only be
  removed while it is empty, and while another cards flow remains.
- The board's **default drop cell** and its **WIP enforcement** are board-wide, so a new card or a
  card moved from elsewhere lands consistently wherever it came from. The Flow view can be narrowed
  to one cards flow, and to one card type within it.
- A **template** captures a set of cards flows — their names, columns and limits — and a new board
  made from it gets all of them. A program or portfolio board has no cards flow of its own.

Each flow's header stays on screen while its columns scroll, so a reader in a long lane keeps the
flow, and its set of columns, in view. The initiatives and boundary bands behave the same way. A cards
flow lines up with the bands above and below it, and a wide flow takes the width its columns need.

A workflow's chevron folds that whole band away to its header: the name, the count and the controls
stay, and the columns give their room to the workflow below. Opening it brings the header to the top
and the columns back underneath, so the band opens where you are looking. The initiatives, cards and
boundary bands each fold on their own, and the state is a view choice rather than an edit.

Each workflow can also carry an optional line under its name — what the workflow is for, in the
board's own words. In **Edit board** the line is edited in place beside the name: Enter or a click
away saves it, Escape reverts, and the clear control removes it. A workflow with no line shows only
its name and count.

## The side drawer

Clicking a card or an initiative opens the **side drawer** on the right; the board stays visible
beside it. The same drawer opens from search, the dashboard, the timeline and the archive.

- **Overview** holds the fields: title, description (Markdown), status, priority, type, people, tags,
  target dates, due date, an external link and the checklist. The target dates are the plan a management surface reads; the
  due date is the one day the work is promised for, and it is the date the **Overdue** and **Due soon**
  filters and every late badge speak about. A passed due date is never a block: it is a chip, and it
  clears when the day is moved or the work is done.
- **Hierarchy** shows the parent, the work below, and dependencies. A dependency links two items and
  says one waits for the other. It runs **across** the hierarchy, never along it: a card cannot wait on
  its own parent or on anything below it. A link that would close a loop is refused rather than
  corrected. The picker is a searchable list that offers only the items the link would be accepted
  for: active work. An archived or discarded item is not offered as a dependency, and an archived item
  cannot be given one. The parent picker follows the same rule — only active initiatives are parents.
  A dependency is a plan, not a block. It never stops a move, and it clears itself when the item it
  waits on reaches Done.
- **Activity** is the item's own history: every move, edit, note and link, with who and when.

Opening a card also brings it into view: the board scrolls the card into the middle of what is left
beside the drawer, so its column and neighbours are in front of the reader. A card already in view is
left where it is.

The drawer is where editing happens. If somebody else is editing the same card, the drawer shows who has
it, and the fields stay closed to you until they finish. A Viewer, and an archived or discarded item,
are read-only. A Viewer can still leave a note, but an archived item accepts no edits or notes.

The eye button on an initiative starts **Focus**, which highlights its lineage on the board. Opening
an initiative does not start it — the button is the only way in — and opening an archived item does
not start it either. A **portfolio** has no focus mode: its outcomes live on the program
and team boards beneath it, and the strategy map is already grouped by what the work is for.

People are chosen from the workspace's own directory, shown with their photo or their initials. Typing
a name searches that directory. The picker never creates a person, because an account arrives by
invitation. <kbd>Escape</kbd> closes the drawer.

<img src="img/guide/card-drawer.webp" alt="The card drawer for Rebuild the signup form, with Overview, Hierarchy and Activity tabs" width="420">

*The drawer is the card's own page beside the board: fields in Overview, lineage in Hierarchy and the
history in Activity.*

## What an initiative shows

An initiative is the outcome above the cards. It has no status field and no estimate of its own:
its status is read from the leaves below it, and its size is the number of those leaves.

<img src="img/guide/initiative-rollup.webp" alt="An initiative card for Signup redesign showing three child pips, a 33 percent progress bar, a still 19d warning and the people on it" width="640">

*An initiative card: the pips are its direct children, the percentage is the share of leaves done,
and the roll-up label says what it rolls up to.*

### Card pips

The small coloured squares across an initiative card are its **direct children**, one pip each, in
the order of the four stages. The colour is the child's own stage — green for Done, violet for In
Progress, blue for Not Started, grey for Backlog.

- A pip is a way into that child: clicking it opens the child and, on a board, brings it into view.
- Pips are direct children, not every descendant. The work beneath a child is behind that child's
  own card.
- Up to 12 pips are drawn; beyond that a **+N** says how many more there are. The count includes
  filed-away children, because the rollup counts them too.

### The progress bar

The percentage and the bar beside the pips are the same number: the share of the **leaf issues
below** the initiative that are done. Every leaf counts once — however many levels of decomposition
sit above it — and an archived leaf still counts, so filing away finished work does not lower a
parent's progress.

The denominator is all the leaves, including those still in Backlog, so planning more uncommitted
work moves the percentage back. A Backlog leaf does not drag the initiative's *status* backwards, but
it does count in the percentage. An initiative with nothing below it has no percentage and no bar,
which is a different fact from 0%. **Done** on the card means every leaf below is done.

### Roll-up and automatic movement

An initiative's **section** is derived from the same rollup:

| The leaves below | The initiative reads as |
| --- | --- |
| Every leaf Done | **Done** |
| Anything started | **In Progress** |
| Nothing started, but something committed | **Not Started** |
| Everything still in Backlog, or nothing below | **Backlog** |

The initiative therefore moves between **Backlog / Not Started / In Progress / Done** by itself when
the work below changes. You do not drag it across a section boundary; dragging arranges it *within*
its section, and a move that would cross a section is refused because the work, not the placement,
decides the section. If its saved cell belonged to another section, the board draws it in the derived
section rather than in the wrong column.

## The boundary — waiting on

Some work waits on something that lives on **another board**. The **Boundary — waiting on** section
below the cards is where that edge is read.

<img src="img/guide/boundary-workflow.webp" alt="The Boundary — waiting on workflow, with external items in their stages and the cards here that wait on them" width="1000">

*The boundary is a lens over external work: the item is shown in the stage its own rollup gives it,
and the cards here that wait on it are named beside it.*

- It appears only when at least one card on this board depends on an item placed on another board.
- The external item is shown in the column its **own rollup** selects, on its own home board. It is
  not copied or moved here, and it is not a placement: it creates no WIP, no card count and no
  rollup on this board.
- Each entry names the home board, its state, and the cards here that wait on it. The card that
  waits wears a **Waiting on …** chip; selecting a boundary card highlights its dependents, and
  selecting a dependent's chip takes you to the boundary card.
- The section is a **lens**, not an editor: nothing can be dragged into it, and the only way to move
  the external work is to open it on the board that owns it.

The entries have four states:

| State | What it means |
| --- | --- |
| **Open · live blockage** | A card here has started and the external item is not done. It is the loudest state. |
| **Open · planning risk** | A card here is still Backlog and the external item is not done. It is a risk to the plan, not a live stop. |
| **Satisfied** | The external item is done; the card here has not finished yet. |
| **Closed** | The card here is done. |

A cleared entry stays in the workflow after it is satisfied or closed, so a reader can see what the
board was waiting for last week. The **Waiting on** chip on a card disappears as soon as the link is
no longer open; the workflow keeps the history. The header counts what is **open** and what has been
**cleared**.

## Related

- [Board types](board-types.md) — team, program and portfolio boards, and what each is for.
- [Warnings and signals](warnings.md) — every badge and warning, and what it means.
- [Using the application](using.md) — the board, a card, an initiative and the views.
