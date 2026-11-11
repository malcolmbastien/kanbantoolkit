# Warnings and signals

The application flags work worth looking at without storing a warning anywhere. Every signal is
derived from state the board already keeps — a card's blocked flag, its placement and arrival stamp,
the dependency links, the people and priorities, the rollup, the target window and the day a piece of
work is due — so a badge cannot disagree with the work it describes, and nothing has to be cleared by
hand.

Two tones:

- **Risk** — red. A hard stop somebody else can see: blocked work, work that waits on something not
  done, a due date that has passed.
- **Watch** — amber. Something to look at: nothing moving, nobody owning it, a due date inside the
  week.

Three thresholds recur: **7 days** for age and staleness (`STALE_AFTER_DAYS`), the same **7 days** for
"due soon" (`DUE_SOON_DAYS`, the window the filter names), and a lane's own **WIP limit**. An
initiative with nothing below it raises nothing.

## On a card

| What you see | What it means | What clears it |
| --- | --- | --- |
| **Blocked**, a full-width red band with the reason | Someone marked the card stopped for something that is not another card. | **Unblock** in the card's panel, which records the change in its history. |
| **N blocked**, a red pill on an initiative card | N cards below are explicitly blocked and still open. On a program or portfolio board the count is amber and reads **N blocked below**. | Those cards are unblocked or finished. |
| **2**, in a chain-link badge | The card waits on two items that are not done — on this board or beyond its edge. The count is the summary; the card's **Dependencies** section names each one. Selecting it opens that section and draws this item's connections. An initiative shows the link door when it has child work or a dependency, even at zero; an empty initiative stays quiet. | Every dependency reaches Done, or the links are removed. |
| **Due 12 Mar**, a slate chip | The day the card is promised for. A date, not a state: the target start/end pair in the drawer is the plan a management surface reads, this is the promise a reader is held to. | The due date is moved in the drawer, or cleared. |
| **Due in 2d**, an amber chip | The due date is inside the week the board's **Due soon** filter names. A chip, never a block: the card can still move, and it clears when the work is done or the day moves. | The card is finished, or the date moves out. |
| **3d overdue**, a rose chip | The due date has passed and the card is not done — the same reading as the **Overdue** filter and the dashboard's Overdue count. | The card reaches Done, or the date moves. |
| **Nd in lane**, a grey clock | In its current committed lane (Not Started or In Progress) for at least 7 days. Backlog is uncommitted inventory and rests; Done is finished, so neither is aged. Not **Stale**, below. | The card moves to another lane. |

A Done card keeps its history but not its warnings: the age cue, a blocked band and the dependency
count are not drawn on its face. The same applies to a completed initiative's health flags.

A card's own dependency on another card is counted on its face and named in the card's
**Dependencies** section; it clears when the card it waits on reaches Done. An initiative above it
reports that wait as **N waiting**.

**Unassigned** is a dashboard signal, below, not a mark on the card.

## On an initiative

Health is shown on the initiative's card in the initiatives flow, in its panel, and in the
dashboard's **Health** column:

| Level | Meaning |
| --- | --- |
| **At risk** | At least one **risk** flag is raised. |
| **Watch** | Only watch flags are raised. |
| **On track** | No rule found anything to say. |

The flags themselves:

| Flag | Tone | What it means | What clears it |
| --- | --- | --- | --- |
| **N blocked** | risk | N cards below are explicitly blocked and still open. | They are unblocked or finished. |
| **N waiting** | risk | N cards below wait on work that is not done. | That work is done, or the links are removed. |
| **still Nd** | watch | The initiative is committed (Not Started or In Progress) and nothing below it has moved for at least 7 days. Where the last movement is unknown, the flag is not raised. | Something below moves. |
| **N unowned** | watch | N committed cards below have no assignee. | Each gets an owner, or leaves the committed stages. |
| **N backlog** | watch | The initiative is committed, but N of its leaves are in Backlog. | Those cards leave Backlog, or the initiative returns to Backlog. |
| **N ending later** | watch | N cards below are planned to end after the initiative's target end date. About the plan's window, not the due date: two promises on different days is not an inconsistency. | The target dates are brought into line, or the cards finish. |

In the item panel, an initiative's warnings are gathered under one **N warnings** heading, and where a
rule found particular cards its chip opens them.

## On the dashboard

The **Needs attention** band reads the population the board renders: cards on a team board,
initiatives on a program or a portfolio. Its tiles are counts, and its table lists the items behind
them:

| Signal | Tone | What it means | What clears it |
| --- | --- | --- | --- |
| **Blocked** | risk | On a card: explicitly blocked, with the reason it carries. On an initiative: the health rule **N blocked**, or its own blocked flag. | It is unblocked, or the cards below are. |
| **Waiting on** | risk | On a card: it waits on another item that is not done, read from the dependency links. On an initiative: its own open dependency, or the health rule **N waiting**. | The item waited on is done, or the link is removed. |
| **Overdue** | risk | Its due date has passed and it is not done. | It is done, or the date is moved. |
| **Due soon** | watch | Its due date falls inside the next seven days — the window the board's **Due soon** filter names — and it is not done. A row never carries both **Overdue** and **Due soon**: a passed day is late, not soon. | It is done, or the date moves out of the window. |
| **Late start** | watch | Its planned target start has passed and it has **not started**: a card in Backlog or Not Started, an initiative whose derived section is Backlog or Not Started. The date is the plan; the board's stage records whether work began, so an item under way is not late. An item with no planned start says nothing. | The work starts, or the target start is moved. |
| **Stale** | watch | On a card: it has sat in Not Started or In Progress for at least 7 days. On an initiative: the health rule **still Nd**. A card in Backlog can show an age badge but is not stale. | It moves. |
| **Unassigned** | watch | On a card: nobody is assigned. On an initiative: the health rule **N unowned**, counting committed cards below with no owner. | Assign somebody, or the work leaves the committed stages. |

The band opens with **All issues**, the default view: every item carrying at least one signal. It is a
way back from a filter rather than a signal of its own, so it is the one tile with no tone.

The dashboard's initiatives table also shows the **Health** column with each flag. Its **Dates**
column reads the target window, with the initiative's due date — and its own overdue chip — under it.

## On a portfolio board

The portfolio board and its **Edit objectives** mode add warnings about coverage, not flow:

| What you see | What it means | What clears it |
| --- | --- | --- |
| **No initiative is mapped to this objective**, an amber line on an objective | The objective has no work mapped to it, and no completeness figure. | Map a top-level initiative to the objective. |
| **over the commitment limit**, a red badge in the period toolbar | The period holds more than five objectives. The limit is a commitment, not a capacity: the view warns, it does not block. | Move an objective to another period or remove one. |

Mapping is attribution, never WIP: moving an initiative between objectives does not move a card or
raise a limit.

## On a lane

| What you see | What it means | What clears it |
| --- | --- | --- |
| **N/limit** in amber, an alert icon, amber hazard tape, a solid amber header and **At WIP limit** | The lane is **at** its WIP limit. Tape and words, not only a tint, so a full lane is not mistaken for another stage colour. | Cards leave the lane. |
| **N/limit** in red, an alert icon, rose hazard tape, a solid rose header and **Over WIP limit** | The lane is **over** its WIP limit. The breach is on the column, in a pattern the board uses nowhere else. | Cards leave the lane. |
| A move that does not happen, or asks for a reason | The board's **WIP enforcement**: **justify** holds the move until a reason is given, recorded on the card; **block** refuses it; **visualize** only marks the lane and lets the move through. | The move is completed with a reason, or the card is placed elsewhere. |

The count is the column's own, not the filtered view's: narrowing what you see never changes the load
a column carries.

## What is not a warning

- The **Blocked** and **Due soon** options in the filter panel narrow the board; they are not badges,
  though **Due soon** and **Overdue** read the same due date the chips do.
- A finished item's **archived** or **discarded** outcome is a fact about where it went, not a
  warning.

## Related

- [Reading a board](reading-a-board.md) — the columns, pips, rollups, multiple flows and external dependencies.
- [Board types](board-types.md) — team, program and portfolio boards.
