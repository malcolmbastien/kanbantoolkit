# PRD — Kanban Toolkit (working title)

**MVP scoped to prove one thing: work is a graph, and boards are views over it.**

Version 0.1 — draft for review
Author: Malcolm B.

---

## 1. Problem

Enterprise kanban tools are board-centric. A card lives *in* a list, a list lives *on* a board, and a board is a container. Three failures follow directly from that containment:

1. **One board at a time.** The same work lives on a portfolio board, a program board, and a team board. Since items can't be in two containers, tools either duplicate them (three copies that drift) or link them (three hyperlinks that rot). Exec boards lie because nobody maintains them.
2. **Dependencies can't cross containers.** "Team A's story is blocked by Team B's epic" has no address. Tools book fake work to represent the dependency, then forget to clear it. Dependency registers are half-stale within a quarter.
3. **Level is a typed field.** Someone marks an item "Epic" in a dropdown. Nothing ever checks that. Three years later the label is a guess.

None of this is a bug in Trello, Jira, or LeanKit. It's the predictable decay of a containment data model.

## 2. Thesis

> Work is a graph, not a board. Flight levels are resolutions of a view over that graph. Nothing carries hand-maintained state that could be derived.

Three derived facts, versus the typed fields every competitor uses:

| Fact | Competitor | Kanban Toolkit |
|---|---|---|
| Item level | typed field | computed from decomposition DAG |
| Dependency state | typed field | computed from both endpoints' current state |
| Portfolio status | curated board | computed from committed items |

Derivation is the moat. Retrofitting it into a tool whose foundation is typed fields is a rewrite — which is what this PRD proposes.

The model draws on Kanban Flight Levels (L1 strategy, L2 coordination, L3 team execution) but replaces the "boards per level" framing with a single graph read at stated resolutions.

## 2.1 Product principles — a joy to use, and never a waste of time

Derivation makes the model honest. These principles make it *worth using*. They are constraints on the product, not aspirations.

**It is a joy to use.** Fast, quiet, predictable. Interactions land where the user expects, a board reads at a glance, and nothing asks for information the graph already knows. Joy is not decoration here — it is the absence of friction and the presence of trust: the tool does what you mean, the first time.

**It respects time.** Every manual update is a tax the tool chose to levy. Kanban Toolkit derives what it can — level, status, dependency state, roll-up — so nobody hand-maintains a fact the system already knows. The measure is not features shipped; it is the answers a person reaches in seconds instead of by chasing six boards and a spreadsheet.

**The human is in control — no AI slop.** Nothing on the board is generated, guessed, or changed behind the user's back. No auto-status, no invented summaries, no recommendation that quietly becomes a fact. Every consequential state is either *derived* from the user's own structure or *set explicitly by a person*, with a reason recorded. If a capability cannot show its work, it does not ship. The user decides what they want, and keeps it.

## 2.2 One truth, two audiences

The same graph must serve people who need different things from it — not by storing two versions of the truth, but by reading one truth at the resolution each audience needs.

- **Executives** get a high-level view that matches what they actually act on: a standard, legible flow; clear status; the ability to drill down; and a visible line to **who is accountable**. They see *that* work is blocked — how much, and where to look — without wading through every team's day-to-day. (The management-board dashboard is this promise made concrete: progress, target date, status, and a count of blocked work down the chain.)
- **Teams** get the opposite: **freedom**. They define their own card flows — split and name their columns, run the workflow that fits them — and break initiatives down however the work actually decomposes. No central schema committee, no single "correct" board.

The two do not conflict, because both read the **same** graph from opposite ends. **Intelligent roll-up is the bridge**: teams work the way they want at the bottom; the information a leader needs rolls up on its own, in the shape of their view — no second data-entry burden, no status anyone has to babysit.

This is the payoff of derivation. Roll-up is not a report someone writes and keeps current; it is a *view of the graph*, so it stays honest for free.

### 2.3 The novel move — separating a team's workflow from its representation of work

Agile asks for two things that pull against each other: **self-organization**, teams deciding how they work, and **transparency**, management being able to see where things stand. Most tools resolve that by picking a side. Hold every team to a standard board and you get comparability at the cost of ownership; let every team invent its own board and you get ownership at the cost of any view above it.

Kanban Toolkit separates the two instead. A team's **card workflow** is theirs: its columns, its splits, its policies, reworked whenever they like. Their **initiative workflow** is the *external representation of the same work* — initiatives in the four typed stages. Neither is a copy of the other and nothing is entered twice, because the initiative view is derived from where the cards actually are. A team can reshape its board on Tuesday without asking anyone, and the portfolio is still correct on Wednesday, because it was never a transcription of the board to begin with.

That separation is the point, and it is what makes the two agile virtues compatible rather than traded off: teams manage their workflow and their cards as they see fit, and management gets the information it needs, without either side telling the other how to work.

## 3. Data model

Everything reduces to nodes and typed edges. There is no board membership field anywhere in the schema.

### 3.1 Items

```
Item {
  id, title, description,
  type,                  // initiative | epic | story | defect
  value_stream_id,       // required — the structural spine
  state,                 // position in this type's lifecycle
  created_at, resolved_at
}
```

**Level is not a field.** It is computed: an item's level follows from what it decomposes into.

```
level(item):
  if item.type == initiative      -> L1
  if it decomposes into epics     -> L2   // enterprise span
  if it decomposes into stories   -> L3
  else                            -> L3   // schedulable unit, the floor
```

Consequences worth stating: level cannot be wrong, because the children determine it. And resolution has a floor — a story doesn't get sub-stories just because someone wants more zoom. Finer decomposition than schedulable work is a checklist.

### 3.2 Boards are projections

A board is a stored query, not a container.

```
Board {
  id, name,
  resolution,      // L1 | L2 | L3 — fixes the counting unit
  scope,           // (value_stream | function | team | enterprise)
  columns,         // lifecycle columns for this resolution
  policy           // optional limits
}
```

Rendering is `Board.scope ∩ Items where level(item) == Board.resolution`. The same epic appears on three boards with one identity:

- L2 value-stream board — a card in the epic workflow, counting against that lane's epic limit
- L3 team board — a **boundary pin**: no column, no WIP count, labelled "waiting on: API decision"
- L1 portfolio board — not as itself; its initiative's status is computed from it and its siblings

**Scope and resolution are independent.** "The Core Experience board" (scope) can be read at epic resolution or initiative resolution. That is a saved-view parameter, not a hierarchy of tiers — the fix for "one board open at a time" recurring at the program tier.

### 3.3 Edges, and the distinction that makes counting honest

Three edge types exist in MVP. Generic relations do not.

| Edge | Meaning | Counts as WIP? |
|---|---|---|
| **Decomposition** (epic → story) | composition; the parent *is* its children | yes, at the parent's level only |
| **Attribution** (initiative → objective) | many-to-many tagging; informs, never composes | **never** |
| **Dependency** (A depends on B) | a dependency between two items | no — never work |

**Attribution never counts.** A story serving two objectives is one unit of work reaching two outcomes. This is the single most important line in the schema: it is what makes cross-objective reporting possible without corrupting anyone's WIP, and what stops limits being gamed by relinking items to a second objective.

### 3.4 Dependencies: edge vs. assertion

The decision that makes dependency registers self-cleaning. Two separate facts:

- **The edge** — permanent record that X relates to Y. Never deleted.
- **The assertion** — computed, not stored: is this edge currently binding?

```
dependency_state(X depends on Y):   // X is the dependent, Y the dependency
  X resolved                      -> Closed
  Y resolved, X unresolved        -> Satisfied
  Y unresolved, X not started     -> Open / planning risk
  Y unresolved, X in progress     -> Open / live blockage
```

Nothing to maintain. The risk state is arithmetic over endpoints. Crucially, the two "Open" readings are **different operational signals despite the same state**:

- *Dependent not started, dependency unresolved* — the plan may be wrong. Cheapest moment in the system for two teams to re-sequence. Information, not interruption.
- *Dependent in progress, dependency unresolved* — someone is actively waiting. Needs a person now.

Most tools emit one "blocked" badge and you cannot tell which you are looking at.

**Slip is computed, not entered.** The quantity that matters is: X cannot enter Done until Y exits. X has a forecast from its position in flow plus its lead-time distribution; Y has a forecast exit. The gap is expected slip. No estimate fields, no dates, nothing to maintain. Dependencies with real slip are the ones to manage; the rest sit quietly. This requires the graph model and cannot be bolted onto a board tool.

**Raising a dependency is immediate.** The person who notices a dependency is always on the dependent side: Team A asserts it against Team B's item and the edge exists at once — there is no confirmation gate to clear. The value is the asymmetry it exposes: B's own card carries a badge — *3 cards depend on this across 2 streams* — so the depended-on team sees the pressure its own board hides. In every current tool the depended-on team's board looks perfectly healthy — because it is. That asymmetry is what kills coordination, and nothing addresses it.

**Cross-level endpoints bind by pinning.** A story waiting on an epic pins to a specific descendant, not to the whole epic. Most such dependencies are really "waiting on the API decision," which is one story; waiting on an entire epic manufactures nine months of artificial wait.

### 3.5 Limits

Limits are **optional and configurable**, keyed on `(resolution, item type, scope)`.

Flow limits (per column/lane) — don't start more than N:
- L1: initiatives
- L2: epics per value stream
- L3: stories

Commitment limits (per period) — don't adopt more than N in a time-box:
- L1: objectives and key results

Objectives and KRs are **not flow items**. They are not started, in progress, or done; they exist for a period and get scored. Putting them in columns builds a measurement register wearing a kanban costume, and it lies within a quarter. "3–5 objectives" was always a commitment limit, not a WIP limit.

Limit policy:

```
LimitPolicy {
  scope_key:       (resolution, item_type, scope_node, column | period)
  counting_rule:   count | size_banded | conflation
  enforcement:     visualize | warn | soft_block(reason required) | hard_block
  thresholds:      { yellow, red }
  effective_dates: from, until
}
```

Defaults: **soft-block with required reason.** Hard blocks drive card-splitting to fit the number rather than fit the work, and you learn nothing. Policies are versioned with effective dates because limits get renegotiated — that is what they are for — and a CFD from last quarter must know which limit was in force.

**Composition pressure is visible, not capped.** Five epics inside a limit of five, each with twenty open stories, is a hundred stories of real work, all "within limits." Do not add a global cap. The epic card carries its open-descendant count against the deeper flow's limit. Levels stay independently limited and visibly coupled.

## 4. UX — LeanKit visual language

Familiar on the surface. The novel machinery is invisible until someone needs it.

### 4.1 Board anatomy

A LeanKit-style sliced board: vertical lanes (state columns) crossed by horizontal rows (lanes), each row's own column set.

```
┌─ Top bar ─────────────────────────────────────────────┐
│ ⊞ Kanban Toolkit   [Board ▾]  Scope: Core Experience ▾      │
│ Resolution: ◉ Epic (L2)  ○ Initiative (L1)  ○ Story (L3)  ⚙ 🔍  ⊡ 100%  │
├──┬────────────────────────────────────────────────────┤
│  │  Backlog │ Analyze │ In Progress │ Ready │ Done     │
│ L│────────────────────────────────────────────────────││
│ A│  [card]    [card]    [card]        [card]           ││
│ N│  ── Team Alpha ───────────────────────────────────││
│ E│  New  Sprint 1  Sprint 2   ...                      ││
│ S│  [card]  [card]  [card]                             ││
└──┴────────────────────────────────────────────────────┘
```

- **Vertical lanes** are states (columns). Lane headers carry `count / limit`, coloured at yellow/red threshold.
- **Horizontal rows** are scopes. Rows nest — a value-stream row contains team rows, each with their own column set (a team may run a different workflow inside the same stream).
- Row rail on the left shows a count badge per row.

### 4.2 Resolution switcher — the structural move

Resolution sits in the board header next to scope, not in navigation. Switching it changes two things at once: **the column set** (initiative lifecycle vs. epic workflow vs. team flow) and **the counting unit**. Scope does not change. Zoom is a dimension of the view, not a jump between containers.

This is what makes "every cell might be another flow" real without nesting boards inside boards: the graph is fixed, and you are choosing the resolution you read it at.

### 4.3 Cards

Compact, dense, LeanKit-like. Each card carries:

| Element | Meaning |
|---|---|
| Type pill (top) | `Objective` `Initiative` `Epic` `Story` — colour-coded |
| Title | one line |
| ID + size | e.g. `(IT2) 472` + points |
| Left edge stripe | colour by value stream |
| Bottom icon row | dependency count, child count, blocked flag |
| Assignee avatar / date | where set |

**Boundary pins** — a card appearing on a board where it does not belong renders differently: no type pill, no column, no WIP count. Dashed left border, "waiting on: <title> (Core Experience)" and a link that opens the item **in a side panel, scoped to its own board**. You never navigate away and lose context.

**Ghost lanes** — when a dependency enters from outside the current scope, the board edge gains a read-only lane containing only the binding items. Cross-scope dependency becomes a visible seam rather than a jump.

### 4.4 Dependency rendering per resolution

The edge is computed once and interpreted per view. Same object, two readings:

- At **L3** — a team-level boundary pin. "Blocked by: API decision (epic, Core Experience)."
- At **L2** — a constraint on the epic's lead-time forecast, shown as the expected-slip number on the connecting edge.

Deliberately two mental models for what looks like one object. Design accordingly rather than falling into it.

## 5. MVP scope

The demo is one enterprise. Three flights, one graph.

### In scope

- Three-way board model: scope × resolution × columns. Scope values: enterprise, value stream, team, function.
- The three counting units with their own lifecycles: initiative (Idea → Option → Bet → Committed / Rejected, plus Dormant as a first-class state — not an archive), epic (standard entry/exit), story.
- Items with no board field. Membership by value stream.
- Edges: decomposition, dependency (FS/SS/FF + lag, with pinning across levels), attribution.
- Dependency lifecycle: raise → computed state → Closed (no confirm/reject gate). Slippage computed from forecasts.
- Boundary pins and ghost lanes.
- Optional, configurable limits per (resolution, item type, scope), with inheritance, override, versioning, and effective dates.
- Objectives and key results as commitment-limited entities, never in columns.
- Computed portfolio rollup: an initiative's status derives from its committed epics and its own decisions.
- **Computed portfolio rollup, not auto-status.** An initiative's status derives from committed work and is shown on a management board dashboard — the board stops lying without removing judgement.

### Out of scope for MVP

- Org charts. Departments are *not* modelled. The scope tree covers value streams, functions, and teams — in most enterprises the functional tree and the value-stream tree are different things, and conflating them is how these tools die.
- Custom entity types and generic relations. Targetprocess won on this model and still lost, because the freedom required a consultant. Flight levels are grammar, not configuration. Nobody invents L2.5.
- Time-boxes/iterations. Board columns handle current work; a time-box is a roadmap entity, which is a version 2 problem.
- Metrics beyond the WIP/lane counts needed to prove counting. CFD, lead-time distributions, Monte Carlo — the *reason* slip computation works — come later. Forecasts use simple flow-based estimates in MVP.
- Burndowns, capacity planning, sprint ceremonies, time tracking.
- Integrations. No Jira, no SSO, no calendar.

### 5.1 Definition of done for the MVP

The demo must show, in one sitting, on real screens:

1. **One item, three boards, no duplication.** An epic on its value-stream board at L2, a boundary pin on a team board at L3, and a rollup contribution on the L1 portfolio view. One identity, three renderings.
2. **Level computed.** Change an item's children, watch its level change. There is no level field to wrong.
3. **Dependency self-cleaning.** Dependent story on Team A, dependency epic on Team B. The dependency resolves; dependency state flips to Satisfied with nobody touching it. Then show it on *both* boards simultaneously.
4. **Attribution that doesn't inflate.** One story attributed to two objectives; WIP count reads 1.
5. **A limit working.** Set epics-per-stream to 4, add a fifth, get the soft block and required reason. Then show the pressure display on the epic carrying 18 open stories.
6. **The exec board that stops lying.** An initiative's status computed from committed work, shown on a management board dashboard.

Items 1 and 3 are the load-bearing ones. If a viewer doesn't feel those, nothing else matters.

## 6. Open decisions

1. **Personal resolution vs. shared.** Can a viewer switch resolution on a shared board? Useful in a portfolio review, but two people reading "the board" would count different things. Proposal: board-level, with personal exploration as a quarantineed state.
2. **Parent boards holding work.** Do nested parent scopes hold items, or only roll up children? Real divisions do both. Proposal: allowed, with rollup explicitly computed so nothing double-counts — but it makes the parent board do two jobs, which is where UX gets hard.
3. **Functions with delivery boards.** Do functions get their own L3 work, or exist only as coordination endpoints at L1? Leaner if the latter; one less thing to explain. The reference picture suggests the latter, but only for this org.
4. **Estimated size at L2.** Counting epics as 1 each when one is a week and another is nine months is the known weak point. Counting rule is policy in the schema; whether MVP ships size-banded defaults is open.

## 7. Risks

| Risk | Mitigation |
|---|---|
| **Targetprocess's graveyard** — the model is right and still failed | Fixed grammar. Flight levels are not configurable. This is the single hardest position to hold in the first enterprise pilot, and the one that most needs defending. |
| **Learning curve** — Trello wins on four-second readability | Default view is a familiar L3 board. Novelty appears only on zoom, and appears as *already-recorded facts* rather than new concepts to learn. |
| **Trusting computed status** — execs who want to type it | Show the derivation on the management board dashboard, with target dates and blocked-down-chain counts, so the computed state is auditable. |
| **Scope creep into "just one more level"** | Section 6.2 and Section 3.3 are the refusal, in advance. |
| **Vision cost** — this needs more screens than a boarding app | It doesn't. It needs one more concept (resolution) and two renderings (boundary pin, ghost lane). |

## 8. What comes after

Roadmap, not scope: the dependency-topology classifier (an initiative whose epics' dependencies cluster across value streams is a shared-services bet in disguise — the graph says it, nobody declares it); org-tree-vs-dependency-graph diagnostics, the sociotechnical angle that falls out of the architecture free; time-boxes as roadmap entities; per-value-stream limit templates.

---

*Working note on visual spec: details in section 4 were derived from the supplied screenshots at the design-system level. Card pill colours, header chrome, and exact lane-header count styling still need pixel verification against the source screenshots before build.*
