# Warnings and signals

The application flags work worth looking at without storing a warning anywhere. Every signal is
derived from state the board already keeps — a card's blocked flag, its placement and arrival stamp,
the dependency links, the people and priorities, the rollup, the target window and the day a piece of
work is due — so a badge cannot disagree with the work it describes, and nothing has to be cleared by
hand.

Two tones carry the difference:

- **Risk** — red. A hard stop somebody else can see: blocked work, work that waits on something not
  done, or a due date that has passed.
- **Watch** — amber. Something to look at: nothing moving, nobody owning it, a due date inside the
  week.

Three thresholds recur: **7 days** for age and staleness (`STALE_AFTER_DAYS`), the same **7 days** for
"due soon" (`DUE_SOON_DAYS`, the window the filter names), and a lane's own **WIP limit**. An
initiative with nothing below it raises nothing: having no work yet is a state, not a finding.

## On a card

| What you see | What it means | What clears it |
| --- | --- | --- |
| **Blocked**, a full-width red band with the reason | A person marked the card stopped for something that is not another card. It is the loudest fact on the card. | **Unblock** in the card's panel, which records the change in its history. |
| **N blocked**, a red pill on an initiative card | N cards below are explicitly blocked and still open. On a program or portfolio board the same count is amber and says **N blocked below**, so a blockage several levels down does not shout at a reader who cannot act on it. | The cards below are unblocked or finished. |
| **N depend on it**, an amber shield | N unresolved items depend on this one; if it slips, they are blocked. It is not shown once this item is done — the dependency is satisfied. | The dependents finish, or the links are removed. |
| **Waiting on**, one or more named chips | The card is waiting on work **outside this board** — the boundary workflow. Each chip names it and takes you to the other end. | The external work reaches Done, or the boundary link is removed. |
| **Due 12 Mar**, a slate chip | The day this card is promised for. It is a date, not a state: the target start/end pair beside it in the drawer is the plan a management surface reads, and this is the promise a reader is held to. | The due date is moved in the drawer, or cleared. |
| **Due in 2d**, an amber chip | The due date is inside the week the board's own **Due soon** filter names. It is a chip, never a block: the card can still move, and it clears when the work is done or the day moves. | The card is finished, or the date is moved out. |
| **3d overdue**, a rose chip | The due date has passed and the card is not done. The same reading the **Overdue** filter and the dashboard's Overdue count speak about — one derivation, so they cannot disagree. | The card reaches Done, or the date is moved. |
| **Nd in lane**, a grey clock | The card has been in its current committed lane (Not Started or In Progress) for at least 7 days. Backlog is uncommitted inventory and rests; Done is finished, so neither is aged. It is not the same as **Stale** (see below), which only counts committed work. | The card moves to another lane. |

A Done card keeps its history but not its warnings: a finished item has no action left, so the age cue, a blocked band, a dependents shield and a boundary chip are not drawn on its face. The same applies to a completed initiative's health flags and warnings.

A card's own dependency on another card is a derived state, not a badge on its face: it is read in
the card's **Dependencies** section and it clears when the card it waits on reaches Done. An
initiative above it does report that wait — as **N waiting**.

**Unassigned** is not drawn on the card itself; it is a dashboard signal, below. **Blocked** and
**Waiting on** are drawn on the card as well — a blocked band and dependency chips — so the
dashboard's count and the card cannot disagree.

## On an initiative

Health is shown on the initiative's card in the initiatives flow, in its panel, and in the
dashboard's **Health** column. The level is one of:

| Level | Meaning |
| --- | --- |
| **At risk** | At least one **risk** flag is raised. |
| **Watch** | Only watch flags are raised. |
| **On track** | No rule found anything to say. |

The flags themselves:

| Flag | Tone | What it means | What clears it |
| --- | --- | --- | --- |
| **N blocked** | risk | N cards below are explicitly blocked and still open. | They are unblocked or finished. |
| **N waiting** | risk | N cards below wait on work that is not done. | The work they wait on is done, or the links are removed. |
| **still Nd** | watch | The initiative is committed (Not Started or In Progress) and nothing below it has moved for at least 7 days. The rule needs to know when the work last moved. Where that is unknown, the flag is not raised. | Something below moves. |
| **N unowned** | watch | N committed cards below have no assignee. | Each gets an owner, or leaves the committed stages. |
| **N backlog** | watch | The initiative is committed, but N of its leaves are still in Backlog. The work below is not all committed with it. | Those cards leave Backlog, or the initiative returns to Backlog. |
| **N ending later** | watch | N cards below are planned to end after the initiative's own target end date. It is about the plan's window, not the due date: two promises falling on different days is not an inconsistency. | The target dates are brought into line, or the cards finish. |

**N depend on it** also appears on an initiative — the same dependents warning a card gets — but it
is not a health rule: it is a fact about the item rather than about the work below it.

In the item panel, an initiative's warnings are gathered under one **N warnings** heading. Where a rule
found particular cards, its chip opens them, so a warning leads to the work rather than only describing it.

## On the dashboard

The **Needs attention** band reads the population the board actually renders: cards on a team board,
initiatives on a program or a portfolio. Its tiles are counts, and its table lists the items
behind them:

| Signal | Tone | What it means | What clears it |
| --- | --- | --- | --- |
| **Blocked** | risk | On a card: it is explicitly blocked, with the reason it carries. On an initiative: the health rule **N blocked** — cards below are blocked and still open — or the initiative's own blocked flag. | It is unblocked, or the cards below are. |
| **Waiting on** | risk | On a card: it waits on another item that is not done, read from the dependency links. On an initiative: its own open dependency, or the health rule **N waiting**, which counts cards below waiting on work that is not done. | The item waited on is done, or the link is removed. |
| **Overdue** | risk | Its due date has passed and it is not done. | It is done, or the date is moved. |
| **Due soon** | watch | Its due date falls inside the next seven days — the same window the board's **Due soon** filter names — and it is not done. A row never carries both **Overdue** and **Due soon**: a passed day is late, not soon. | It is done, or the date is moved out of the window. |
| **Late start** | watch | It has a planned target start that has passed and it has **not started**: a card still in Backlog or Not Started, an initiative whose derived section is Backlog or Not Started. The date is the plan; the board's stage is the record of whether work began, so an item already under way is not called late. An item with no planned start says nothing. | The work starts, or the target start is moved. |
| **Stale** | watch | On a card: it has sat in Not Started or In Progress for at least 7 days. On an initiative: the health rule **still Nd** above. A card in Backlog can show an age badge but is not called stale. | It moves. |
| **Unassigned** | watch | On a card: nobody is assigned. On an initiative: the health rule **N unowned**, which counts committed cards below that have no owner. | Assign somebody, or the work leaves the committed stages. |

The band opens with **All issues**, the default view: every item carrying at least one signal.
It is the way back from a filter rather than a signal of its own, so it is the one tile with no
tone — and it is where the card starts.

The dashboard's initiatives table also shows the **Health** column with each flag. Its **Dates**
column reads the target window, with the initiative's due date — and its own overdue chip — under it,
so the promise is in front of a reader as well as on the card.

## On a portfolio board

The strategy map and the objectives view add warnings about coverage, not flow:

| What you see | What it means | What clears it |
| --- | --- | --- |
| **No initiative is mapped to this objective**, an amber line on an objective card | The objective has no work mapped to it. It has no completeness figure either, because there is no work to read. | Map a top-level initiative to the objective. |
| **N gaps** in amber in the strategy map's header | The number of objectives with nothing serving them plus top-level initiatives in the portfolio's remit serving no objective. | Either gap is closed. |
| **No objective yet**, an amber group on the strategy map | Strategic initiatives on the portfolio that no objective carries. They are shown as a flow of their own, waiting to be mapped. | Map each to an objective. |
| **over the commitment limit**, a red badge in the objectives header | The period holds more than five objectives. The limit is a commitment, not a capacity: the view warns, it does not block. | Move an objective to another period or remove one. |

Mapping is attribution, never WIP. Moving an initiative from one objective to another changes which
objective it serves; it does not move a card or raise a limit.

## On a lane

| What you see | What it means | What clears it |
| --- | --- | --- |
| **N/limit** in amber, an alert icon, amber hazard tape across the column, a solid amber header and the words **At WIP limit** | The lane is **at** its WIP limit. Tape and words, not only a tint, so a full lane is not mistaken for another stage colour. | Cards leave the lane. |
| **N/limit** in red, an alert icon, rose hazard tape across the column, a solid rose header and the words **Over WIP limit** | The lane is **over** its WIP limit. The breach is on the column, in a pattern the board uses nowhere else. | Cards leave the lane. |
| A move that does not happen, or asks for a reason | The board's **WIP enforcement** is doing its job: **justify** holds the move until a reason is given (the reason is recorded on the card), and **block** refuses it. **Visualize** only marks the lane and lets the move through. | The move is completed with a reason, or the card is placed elsewhere. |

The count is the column's own, not the filtered view's: narrowing what you see never changes the
load a column carries.

## What is not a warning

- The **Blocked** and **Due soon** options in the filter panel are ways to narrow the board, not
  badges of their own — though **Due soon** and **Overdue** read the same due date the chips do.
- A finished item's **archived** or **discarded** outcome is a fact about where it went, not a
  warning.

## Related

- [Reading a board](reading-a-board.md) — the columns, pips, rollups, multiple flows and the boundary.
- [Board types](board-types.md) — team, program and portfolio boards.
