# Warnings and signals

The application flags work worth looking at without storing a warning anywhere. Every signal is
derived from state the board already keeps — a card's blocked flag, its placement and arrival stamp,
the dependency links, the people and priorities, the rollup and the target dates — so a badge cannot
disagree with the work it describes, and nothing has to be cleared by hand.

Two tones carry the difference:

- **Risk** — red. A hard stop somebody else can see: blocked work, or work that waits on something
  not done.
- **Watch** — amber. Something to look at: nothing moving, nobody owning it, a date that has passed.

Two thresholds recur: **7 days** for age and staleness (`STALE_AFTER_DAYS`), and a lane's own **WIP
limit**. An initiative with nothing below it raises nothing: having no work yet is a state, not a
finding.

## On a card

| What you see | What it means | What clears it |
| --- | --- | --- |
| **Blocked**, a full-width red band with the reason | A person marked the card stopped for something that is not another card. It is the loudest fact on the card. | **Unblock** in the card's panel, which records the change in its history. |
| **N blocked**, a red pill on an initiative card | N cards below are explicitly blocked and still open. On a programme or portfolio board the same count is amber and says **N blocked below**, so a blockage several levels down does not shout at a reader who cannot act on it. | The cards below are unblocked or finished. |
| **N depend on it**, an amber shield | N unresolved items depend on this one; if it slips, they are blocked. | The dependents finish, or the links are removed. |
| **Waiting on**, one or more named chips | The card is waiting on work **outside this board** — the boundary workflow. Each chip names it and takes you to the other end. | The external work reaches Done, or the boundary link is removed. |
| **Nd in lane**, a grey clock | The card has been in its current lane for at least 7 days. It is an age cue for any card, including one in Backlog; it is not the same as **Stale** (see below), which only counts committed work. | The card moves to another lane. |

A card's own dependency on another card is a derived state, not a badge on its face: it is read in
the card's **Dependencies** section and it clears when the card it waits on reaches Done. An
initiative above it does report that wait — as **N waiting**.

**Unassigned** and **No priority** are not drawn on the card itself; they are dashboard signals,
below.

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
| **still Nd** | watch | The initiative is committed (Not Started or In Progress) and nothing below it has moved for at least 7 days. It is only raised when the work carries an arrival stamp; an unknown last movement is not called movement. | Something below moves. |
| **N unowned** | watch | N committed cards below have no assignee. | Each gets an owner, or leaves the committed stages. |
| **N backlog** | watch | The initiative is committed, but N of its leaves are still in Backlog. The work below is not all committed with it. | Those cards leave Backlog, or the initiative returns to Backlog. |
| **N due later** | watch | N cards below have a target end date after the initiative's own target end date. | The dates are brought into line, or the cards finish. |

**N depend on it** also appears on an initiative — the same dependents warning a card gets — but it
is not a health rule: it is a fact about the item rather than about the work below it.

In the item panel, an initiative's warnings are collected under a single **N warnings** heading. A chip opens the cards its rule found, where it found particular ones, so a warning leads to the work rather than only describing it.

## On the dashboard

The **Needs attention** band reads the population the board actually renders: cards on a team board,
initiatives on a programme or a portfolio. Its tiles are counts, and its table lists the items
behind them:

| Signal | Tone | What it means | What clears it |
| --- | --- | --- | --- |
| **Unfinished** | — | Every unfinished item on the board. This is the population the other counts are taken from, not a warning. | The item is done or archived. |
| **Overdue** | risk | Its target end date has passed and it is not done. | It is done, or the date is moved. |
| **Stale** | watch | On a card: it has sat in Not Started or In Progress for at least 7 days. On an initiative: the health rule **still Nd** above. A card in Backlog can show an age badge but is not called stale. | It moves. |
| **Unassigned** | watch | On a card: nobody is assigned. On an initiative: the health rule **N unowned** — committed cards below have no owner — spoken of as unassigned rows. | Assign somebody, or the work leaves the committed stages. |
| **No priority** | watch | The item has no priority set. | A priority is chosen. |

The dashboard's initiatives table also shows the **Health** column with each flag, and an overdue
target date is written in red with the word **overdue** underneath it.

## On a portfolio board

The strategy map and the objectives view add warnings about coverage, not flow:

| What you see | What it means | What clears it |
| --- | --- | --- |
| **No strategic initiative serves this OKR**, an amber line on an objective card | The objective has no work mapped to it. It has no completeness figure either, because there is no work to read. | Map a strategic initiative to the objective. |
| **N gaps** in amber in the strategy map's header | The number of objectives with nothing serving them plus strategic initiatives serving no objective. | Either gap is closed. |
| **No objective yet**, an amber group on the strategy map | Strategic initiatives on the portfolio that no objective carries. They are shown as a flow of their own, waiting to be mapped. | Map each to an objective. |
| **over the commitment limit**, a red badge in the objectives header | The period holds more than five objectives. The limit is a commitment, not a capacity: the view warns, it does not block. | Move an objective to another period or remove one. |

Mapping is attribution, never WIP. Moving an initiative from one objective to another changes which
objective it serves; it does not move a card or raise a limit.

## On a lane

| What you see | What it means | What clears it |
| --- | --- | --- |
| **N/limit** in amber, with an alert icon | The lane is **at** its WIP limit. | Cards leave the lane. |
| **N/limit** in red, with an alert icon | The lane is **over** its WIP limit. | Cards leave the lane. |
| A move that does not happen, or asks for a reason | The board's **WIP enforcement** is doing its job: **justify** holds the move until a reason is given (the reason is recorded on the card), and **block** refuses it. **Visualize** only tints the lane and lets the move through. | The move is completed with a reason, or the card is placed elsewhere. |

The count is the column's own, not the filtered view's: narrowing what you see never changes the
load a column carries.

## What is not a warning

- The **Blocked** and **Due soon** options in the filter panel are ways to narrow the board, not
  badges of their own.
- A finished item's **archived** or **discarded** outcome is a fact about where it went, not a
  warning.
- An objective's **score** is a person's grade at the end of a period; it is not derived and never
  raises a signal.

## Related

- [Reading a board](reading-a-board.md) — the columns, pips, rollups, multiple flows and the boundary.
- [Board types](board-types.md) — team, programme and portfolio boards.
