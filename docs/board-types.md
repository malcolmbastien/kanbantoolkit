# Board types

Every board has a **flight level** — **Team**, **Programme** or **Portfolio**. The level is not a
label on the board: it decides what the board renders, what work can be entered on it, and where its
initiatives roll up. Choose it when the board is made.

| | Team | Programme | Portfolio |
| --- | --- | --- | --- |
| **What it holds** | Its team's cards, and the initiatives they roll up into | Its own initiatives, plus a band for each linked board | Objectives and the strategic initiatives that serve them |
| **What it shows** | Cards flows, the initiatives flow, dashboard, timeline, flow metrics, archive | The initiatives flow and bands of linked boards; dashboard and timeline | A strategy map: objectives, key results, coverage gaps |
| **Cards** | Yes — a card belongs to a team board | No cards flow | No cards flow |
| **Flow metrics** | Yes | Not offered | Not offered |
| **Used for** | Doing the work | Coordinating teams and rolling work up | Deciding and communicating what the work is for |

The three levels link upward. A programme can aggregate team boards, or other programme boards; a
portfolio can link programmes. The aggregation graph may be any depth and mix the levels, so long as
it stays **acyclic** — a board cannot end up beneath itself.

## Team boards

The working board. It carries the team's own **cards flows** — one or more sets of the four typed
columns — and the **initiatives flow** the cards roll up into. Cards are made here, moved here, and
limited here; the board's WIP policy, card types, tags, default drop cell and flow metrics all belong
to this level.

This is where a card's real life happens. An initiative on the same board is the outcome the work
belongs to, and its progress is computed from the cards below it.

**Use it for**

- A product squad delivering features, with work moving Backlog → Not Started → In Progress → Done.
- A support team whose incoming requests are a second cards flow beside its delivery work, so the
  queue has its own columns and WIP limit without mixing with planned work.
- A platform team whose cards roll up into an initiative that a programme reads, without anyone
  keeping a second tracker for the programme.

**Not for:** portfolio reporting, or a list of other teams' work. Put a programme above it instead.

## Programme boards

A coordination board. (The app labels this level **Program**.) It has its own initiatives flow — the outcomes the programme owns — and a
**band for each linked board**, showing the initiatives from the teams or programmes beneath it. It
does not carry a cards flow: nobody makes a card on a programme board, because the work belongs to
the team that does it.

The programme is for the questions a single team cannot answer: which initiatives are moving, which
are blocked or waiting, which teams depend on each other, and what the combined picture looks like.
Its dashboard and timeline read the same initiatives, not a copy of them.

Each linked band is **read-only**: it is a rollup of that board's initiatives, and the band says so
at its header. To move an initiative, change its flow or edit its board design, use **Open board** —
the work stays on the board that owns it.

**Use it for**

- A value stream over three squads: one band per squad, read for progress, risk and dependencies.
- A programme bridging two delivery teams that ship together, where each team keeps its own board
  and the programme shows what the combined delivery is doing.
- A line of business that aggregates several programmes, each of which aggregates its own teams.

**Not for:** a second set of tickets, or day-to-day task management. If a card needs to move, it
belongs on a team board beneath the programme.

## Portfolio boards

The strategy board. It leads with the **strategy map**: the board's own initiatives grouped by the
**objectives** they serve, with key results and the two coverage gaps — an objective nothing serves,
and an initiative serving nothing. Objectives and key results are authored here; an initiative serves
one objective, and is moved between them deliberately.

A portfolio has no cards flow and no bands. Its links to programmes still exist for the rollup, but
the portfolio surface chooses to read the work by objective rather than by team. That is the point of
the level: a reader should see whether the strategy is covered, not which squad is busiest.

**Use it for**

- An annual or quarterly strategy with a small set of objectives, each carrying the strategic
  initiatives that serve it, reviewed for coverage and dropped work.
- An investment review: what is being funded, what it is for, and where a stated objective has no
  initiative behind it.
- A leadership board that connects outcomes to delivery without turning into a delivery board.

**Not for:** tracking cards or team flow. Use the programme and team boards beneath it for that.

### Using objectives on a portfolio board

Open the portfolio board and choose **Objectives**. This is the only place objectives and key
results are authored; they are not a global view.

**Periods.** A period is a label on an objective, not a separate record, so there is no separate
period screen to visit. Choose an existing period in **Period**, or press **New period**, name it
(for example `FY27 Q1`) and press **Create period**. Then add the first objective; it joins that
period. A period exists while an objective uses it, so an empty period is not kept after you leave
the view: add its first objective before moving on. Periods are matched exactly, so keep one
spelling — `FY26 Q4` and `fy26 q4` are two different periods.

**Add an objective.** With the period chosen, type the outcome beside **New objective** and press
Enter or the button. The card's title is editable in place. Aim for three to five objectives in a
period; the view warns above five, because the limit is a commitment rather than a capacity. Keep
the status **active** while the period is running and move it to **scored** at the end; the score
(0–100) is a person's grade of how the period went, and is separate from the completeness below.

**Key results.** Add the statements that say what the objective means. A key result is a line of
text, not a number or a target: the objective's completeness is computed from the work below the
initiatives that serve it, so there is no hand-entered percentage that can disagree with the work.

**Connect an initiative.** A strategic initiative is an initiative placed on a portfolio board. Use
**Map an initiative…** at the bottom of an objective card to attach one, then **Map**. An initiative
serves one objective, so choosing one that already serves another moves it; the option says
“moves from …” before you commit. Detach one with the × beside it. Mapping is attribution: it never
counts as WIP, and it does not move a card.

**See the gaps.** The strategy map groups the portfolio's initiatives by the objective they serve,
and shows both coverage gaps: an objective that nothing serves, and an initiative that serves
nothing. An objective's completeness is the union of the leaves below its initiatives — each leaf
once — and an objective nothing serves has no percentage at all, because there is no work to read.

## Choosing a type

Ask what the board is for, not who opens it:

- **Does work move through columns?** A team board.
- **Do you need to see several teams or a value stream together?** A programme board.
- **Are you deciding or communicating what the work is for, with objectives and coverage?** A
  portfolio board.

The type is a board setting, but it is not a skin: it decides which surfaces exist and where the
initiatives roll up. A board made as a team board and later changed to a programme does not gain the
bands of work that was never linked to it. Start at the level the work belongs to.

## A worked example

A company runs one portfolio, **Company Strategy**, with objectives such as “Recurring revenue
engine”. Beneath it, a programme board, **Product Delivery**, links the team boards **Team Atlas** and
**Team Nova**. Atlas and Nova each work their own cards; their initiatives appear as bands on Product
Delivery; the strategic initiatives that serve an objective appear on the portfolio's strategy map.

The same card is read three ways without being copied: the team moves it, the programme rolls it up,
and the portfolio asks which objective it serves. No level keeps its own version of the work.

## Related

- [Using the application](using.md) — the board, a card, an initiative and the views.
- [Reading a board](reading-a-board.md) — the drawer, columns, pips, rollups, multiple flows and the boundary.
- [Lean metrics](metrics.md) — the Flow view, which is a team board's own reading.
