# Lean metrics and reporting

The plan for the **Flow** view: what it measures now, what to add, and what it deliberately stays
out of. It is a strengthening of one screen, not a reporting product.

The references are at the bottom. The short version of all four: show distributions rather than
averages, make waiting and blocked time visible, check the data before reading it, and forecast with
a range instead of a date.

## What the Flow view does today

One screen per board, computed from the cards' own histories (`src/domain/metrics.ts`):

- In flight, delivered, lead time and cycle time — median and p85, with the number of cards behind
  each.
- A cumulative flow diagram over the last 8 weeks, by stage.
- Throughput per week for the same 8 weeks.
- The eight slowest delivered cards, each opening the card panel.

It is derived, read-only, and stored nowhere. It already has the honesty the references ask for:
stage-based history survives a board redesign, and the screen says that history starts the day the
app began recording moves.

What it does not have:

- no date range, and no way to see one cards flow rather than all of them;
- no distribution — a median and a p85 hide the shape and the outliers;
- no aging work, so the cards that are stuck right now are invisible;
- no blocked time, although the model records blocked and unblocked events;
- no forecast, and no service level expectation;
- no way to see how much of the waiting is queueing rather than work.

## What the references agree on

**Troy Magennis / Crisp — forecasting and coaching with data.** Use percentiles and ranges, not
single numbers. Build a *balanced* dashboard: improve the system, not one metric. Forecast duration,
capacity and scope from history when it exists, and use range estimates when it does not. Keep
dependencies and queues in view, because they are what make delivery uncertain.

**Planview LeanKit — measuring and reporting.** WIP, queues, blockers, lead time, cycle time,
throughput, Little's Law, and the cumulative flow diagram. Blockers are the easiest useful metric
for a new team: count them *and* measure how long they last. A CFD answers several questions at
once — WIP now, approximate lead time by horizontal distance, throughput by the slope of Done.

**Kanbanize / Businessmap — kanban analytics.** The chart set: CFD, cycle time scatterplot,
cycle time histogram, throughput histogram, aging WIP, flow efficiency, blocker clustering, and
Monte Carlo for "when will it be done" and "how many by then". Service level expectations are read
from the cycle-time distribution at 85% and 95%.

**JiraMetrics — the data-quality first report.** Every report opens with a **Data Quality** section:
items moved back to the backlog, items finished before they started, status changes after Done,
backwards moves, items created straight into a working column, done work with open subtasks, and
items counted on more than one board. Those are not all mistakes; they are places where the team's
real process does not match the start-to-finish model, and the reader should know before reading the
charts. It also sets the aging line at the 85th percentile of completed work, caps a scatter's y
axis at a high percentile so the tail does not squash the bulk, and warns that a trend line on a
scatter is descriptive, not predictive.

**What this plan takes from that.** The three additions that pay for themselves first are the
distribution (scatter and histogram), aging work, and blocked time — with a data-quality check
above them, because a chart read without its context is worse than no chart. Forecasting comes next,
because it needs enough history to be honest. Flow efficiency waits, because the model cannot yet
tell a queue from active work without a new lane setting.

## Rules the work follows

1. **Derived, never stored.** Every number comes from the item log, placements, lanes and flows that
   already exist. No snapshot table, no nightly rollup, no target to keep in step.
2. **The stage is the stable grain.** A team renames and splits columns; the four stages do not
   move. Column-level history is used only where a log entry carries a lane id.
3. **A percentile carries its sample.** p85 of four cards is a rumour. Every figure shows `n`, and
   thin history says so in words rather than drawing a confident line.
4. **No new data entry.** Nothing asks a person to estimate size, score a card, or classify work.
   If a metric needs data the board does not already record, it waits for a deliberate model change.
5. **Read-only.** There are no targets, no red/green scores and no generated narrative. A chart is
   the report.
6. **One screen.** No report builder, no saved report definitions, no per-person metrics. A range
   and a flow filter are the only controls.
7. **Accessible and dependency-free.** Inline SVG and the existing bar primitives, no chart library.
   Each chart has a sentence summary and a table of its numbers for a screen reader.
8. **The first download does not grow.** `metrics.ts` is imported by the lazy Flow screen only, so
   additions belong there and must stay there.
9. **Balanced, not one number.** Every phase pairs a speed reading with a waiting one — cycle time
   with aging, throughput with WIP and blocked time — so a team cannot improve one by moving the
   cost somewhere the screen does not show.
10. **The data is checked before it is interpreted.** The Flow view opens with a short data-quality
    line — backwards moves, work finished before it started, changes after Done, cards on more than
    one board — with links to the cards. It never blocks a chart; it says how to read it.

## Phase 1 — Make the current view honest and useful

No schema change. One pull request per line, or two small ones.

| # | What | Why | Size |
| --- | --- | --- | --- |
| 1.1 | **Range and flow controls.** 4, 8, 12, 26 weeks or all history (default 12); all cards flows or one. Kept in the URL (`range`, `flow`) so a link shows the same reading. | The board can carry several flows now, and 8 weeks is a guess. Sharing a reading is how a team discusses it. | S |
| 1.2 | **Distribution summary.** p50, p85 and p95 for lead and cycle, each with `n`; keep in flight and delivered. A one-line definition behind each label. | Percentiles are the SLE language the references use; the current median + p85 is almost there. | S |
| 1.3 | **Cycle time scatterplot.** One dot per delivered card, x = completion date, y = cycle days; p50/p85/p95 lines; hover says the card and its dates; click opens the card. The y axis caps at p98, with the rest drawn as a count above an axis break so the long tail cannot squash the bulk. No trend line by default. | Outliers are the story, and a scatter is the cheapest way to see them. A straight trend line over a scattered cloud looks more certain than it is. | M |
| 1.4 | **Aging work.** Open cards in the selected flow, oldest first: card, column, time in that column, and **time since commitment** — with the cycle-time p85 drawn as the reference line. A card past the line has been in flight longer than 85% of the work the team finished. Rows also mark **stalled** when nothing has moved for the app's staleness threshold, separately from blocked. Click opens the card. Counts per stage above the list. | The most actionable lean metric is "what is old right now", and the data is already there (`laneEnteredAt` and the last move). The line belongs on time since commitment, not time in the column, or it compares two different clocks. | M |
| 1.5 | **Blocked work.** Cards blocked now, days blocked so far; in the window, total blocked days, median and p85 blocked duration, and the five most common blocker reasons. | Blocked time is invisible in lead time, and the log already has both ends of every interval. | S–M |
| 1.6 | **The two histograms.** Cycle time in day buckets and weekly throughput counts, with the p50/p85 markers on the cycle one. | The shape a median hides; also shows whether "done" arrives in batches. | S–M |
| 1.7 | **Little's Law check.** Average WIP ÷ throughput = implied cycle time, shown beside the measured cycle time. | One sentence that teaches the relationship, and a check that the two panels agree. | S |
| 1.8 | **Thin data, said plainly.** The first recorded move's date, how many cards have no move history, and "not enough delivered cards" states instead of empty charts. | The screen currently says history is thin once, at the top; the individual panels should say it where it matters. | S |
| 1.9 | **Data quality.** A short section under the header with counts and links: moved backwards, moved back to Backlog after commitment, changed after Done, finished before it started, created outside Backlog, done with open children or checklist items, and cards placed on more than one board. Each names what it means and never blocks a chart. | JiraMetrics' lesson: the charts are only as good as the data, and the reader should know where the process bends the model. | S–M |

**Ends with:** a team can open Flow for a chosen quarter and flow, see the shape of its cycle time,
find the cards that are old or blocked today, know where the data bends the model, and click any of
them. Everything still derives from the board, with no migration and no new field.

## Phase 2 — Forecast from the same history

Still no schema change.

| # | What | Why | Size |
| --- | --- | --- | --- |
| 2.1 | **Service level expectation.** "85% of delivered cards took N days or less", with a 50/85/95 selector, from the same cycle-time sample. | The simplest useful planning number, and it is already a percentile. | S |
| 2.2 | **When will this scope be done.** Monte Carlo over weekly throughput: draw weeks with replacement until the remaining cards are consumed, 5,000 trials, answer p50/p85/p95 dates. Scope is the selected flow, or all committed open cards (Backlog optional). | The question people actually ask, answered as a range rather than a date. | M–L |
| 2.3 | **How many by a date.** The same trials, read the other way: probability that N or more cards finish by a chosen date. | The fixed-date counterpart for a release or a quarter. | S (shares the simulation) |
| 2.4 | **The assumptions, on screen.** Scope stays fixed; the future resembles the sampled weeks; weekly grain; dependencies and batch size are not modelled. Re-forecast when scope changes. | A range without its assumptions is a promise the data cannot keep. | S |
| 2.5 | **The rows behind the charts.** A CSV of delivered cards with created, committed, done, lead, cycle and blocked days for the window. | A team that wants a spreadsheet should not have to scrape the screen, and it fits the existing board CSV. | S |

Minimums before forecasting: at least 4 weeks in the window and at least 8 delivered cards.
Below that the screen says what is missing and shows nothing else. Magennis's range estimates are
the right fallback, and they are deliberately not built: a typed range would be a second source of
truth beside the board.

**Ends with:** "at this pace, this scope is done between these two dates, with this confidence" — and
the evidence to argue with it on the same screen.

## Phase 3 — Only if teams ask

These are real lean metrics, but each costs something the plan above avoids.

- **Flow efficiency.** The share of cycle time spent active rather than waiting. It needs a lane
  property — *this column is a queue* — because the four stages cannot tell a review queue from
  work. That is a board-design field, a persistence migration and a schema bump, and it can only
  measure *forward*: history before the setting existed cannot be classified. Worth doing if
  queues are the team's problem, not before.
- **WIP by column.** How much time each column spent at each WIP level, with the configured limit
  drawn on it — JiraMetrics' `wip_by_column_chart`. The lane ids in the log make it possible. It
  stops at showing the limit: automatic limit recommendations from a few months of data would be
  advice the sample cannot support.
- **A single-item forecast.** "Days likely remaining" for an aging card, from how long work
  historically took to cross the columns that remain (JiraMetrics' aging-table forecast). It is a
  per-card version of the scope forecast, and it refuses when the card is already older than the
  percentile it would use.
- **Blocker clustering by category.** Today a blocker's reason is free text. Clustering by exact
  text (case-insensitive) is cheap and belongs in 1.5; real categories need a small, fixed list or
  a tag convention, which is data entry we are not adding yet.
- **Breakdowns.** Cycle time by card type, assignee or tag; aging by owner. Useful once the base
  panels are trusted. Keep it to a grouping selector on the scatter, not a pivot builder.
- **Portfolio rollups.** The programme and portfolio boards already roll up initiatives. A flow
  reading across linked boards is a different question (different teams, different throughput) and
  belongs with the portfolio surfaces, not here.

## Deliberately not planned

- A custom report builder, dashboard designer or scheduled email reports.
- Stored metric snapshots, a warehouse, or a second database for analytics.
- Story points, estimates or any size field; the board counts issues and the rollups are issue
  counts.
- Burn-down or velocity charts; they assume a fixed scope and a sprint, and this board does not.
- An AI-written summary of the charts. The numbers are the report, and the project does not send
  work to a model.
- Cross-team comparison or individual performance metrics. Both punish the wrong behaviour.

## The model and the functions

All of it lives in `src/domain/metrics.ts`, pure and unit-tested. The existing shapes stay:

- `FlowRecord` — one card's history as stage moves (`startedIn`, `moves`), created, resolved and
  archived times.
- `stageAt`, `committedAt`, `inFlightAt` — the clocks everything else reads.

Add, in roughly this order:

| Function | Answers | Notes |
| --- | --- | --- |
| `windowOf(range, now)` | the start of the window | `range` is weeks or `'all'` |
| `withinWindow(records, window)` | delivered/created-in-window records | documented inclusive/exclusive boundaries |
| `stageSpans(record)` | days per stage, in order | from `moves`; last span open until now |
| `blockedSpans(record, now)` | blocked intervals | pair `blocked`/`unblocked` log entries; an open interval ends at `resolvedAt` or now |
| `blockedDays(spans, window)` | blocked days in the window | clipped, never double-counted |
| `aging(records, now)` | open cards with column, days in column, days since commitment, stalled | `laneEnteredAt`, else the last move, else created; stalled reuses `STALE_AFTER_DAYS` |
| `histogram(values, width)` | buckets with counts | whole days for cycle time, counts for throughput |
| `sampleStats(values)` | `n`, min, p50, p85, p95, max | one place for percentile rules |
| `averageWip(records, buckets)` | mean in-flight count | already derivable from `cumulativeFlow` |
| `forecast(remaining, weeklyThroughput, opts)` | p50/p85/p95 weeks and a by-date probability | seeded PRNG, fixed 5,000 trials, deterministic in tests |
| `dataQuality(records, context)` | counts and item ids for the checks above | record checks are pure; the view supplies multi-board placements and blocked-with-done-dependency ids |

Rules that need writing down and testing:

- A card created before the window but delivered inside it counts toward lead and cycle for that
  window; a card delivered before it does not.
- Moving a card out of Done clears `resolvedAt`; it is open again and leaves the delivered sample.
- A card archived mid-flight leaves WIP and the CFD from that point, but stays in the past it was
  part of. A card archived from Done stays delivered.
- Blocked time stops at resolution: a card cannot keep accruing blocked days after it is done.
- Days are elapsed milliseconds divided by 86,400,000. No timezone, no calendar days, no DST.
- A forecast with zero throughput in every sampled week has no answer; say so instead of dividing
  by zero.

## Screens and interaction

- **One toolbar** above the panels: range, flow, and the definition of the four headline numbers.
- Panels in the current visual language: white card, uppercase title, one line of explanation.
  Charts use the existing stage colours; no new palette.
- Every dot and every aging row opens the card panel. A chart that cannot take you to the work is
  a dead end.
- The empty and thin states are sentences, not blank axes: what is missing, and what would make it
  appear.
- URL: `?board=<id>&view=flow&range=12w&flow=<flowId>`. Unknown values fall back to the defaults,
  the same way the rest of `lib/url.ts` treats a bad place.
- Accessibility: each chart carries a summary sentence and a `<details>` table with the same
  numbers; controls are labelled; nothing is encoded by colour alone.

## Tests and the gates

- **Unit (`src/domain/metrics.test.ts`).** Hand-built logs with exact answers: lead and cycle at
  window edges; a card moved back out of Done; blocked intervals clipped at both ends; a card with
  no move history and no `laneEnteredAt`; percentiles on 1, 2 and many samples; histograms; average
  WIP; forecast determinism and its refusal below the minimums; each data-quality check firing once
  on its own fixture and staying quiet on a clean one.
- **E2E.** The range and flow controls change the numbers; a scatter dot and an aging row open the
  card; a thin board says so; the Flow screen passes the existing accessibility sweep.
- **Gates.** `npm run typecheck`, `npm test`, `npm run lint`, `npm run scan`, `npm run size`,
  `npm run docs:check`, `npm run test:e2e`. The Flow screen is a lazy chunk; confirm the first
  download is unchanged after each phase.

## Order and effort

| Step | Depends on | Effort |
| --- | --- | --- |
| 1.1 range and flow | — | 0.5 day |
| 1.2 summary with p50/p85/p95 | 1.1 | 0.5 day |
| 1.3 scatter | 1.1 | 1 day |
| 1.4 aging | 1.1 | 1 day |
| 1.5 blocked | 1.1 | 1 day |
| 1.6 histograms | 1.2 | 1 day |
| 1.7 Little's Law | 1.2, 1.6 | 0.5 day |
| 1.8 thin states | 1.1–1.7 | 0.5 day, spread |
| 1.9 data quality | 1.1 | 1 day |
| 2.1 SLE | 1.2 | 0.5 day |
| 2.2–2.3 Monte Carlo | 2.1, 1.6 | 2 days |
| 2.4 assumptions | 2.2 | 0.5 day |
| 2.5 CSV | 1.1 | 0.5 day |

Phase 1 is about a week of work; Phase 2 is two to three days. That is the whole proposal.

## Decisions taken, and the ones still open

Taken:

- **Cycle starts when the card leaves Backlog** — the team's commitment point. That matches
  Planview's commitment-point framing, not "work started", and the screen says which.
- **Lead is created → done; cycle is committed → done.** One definition each, everywhere.
- **Aging is time in the current column**, falling back to the last stage move when a lane stamp is
  missing.
- **The forecast is weekly and scope-based**, not per-card. Per-card forecasting needs size, and
  this board does not have a size.
- **The window defaults to 12 weeks**, with all history available for small boards.
- **Data quality is shown, not enforced.** The checks flag and link; they never hide a card or refuse
  a move. A process that intentionally moves work backwards is allowed to say so.
- **Stalled is the app's 7-day threshold**, the same one the health rules use, not a second number.
- **The aging line compares time since commitment with completed cycle time.** Time in the current
  column is shown too, as a separate fact, because comparing it to cycle time would be wrong.

Open, to settle before Phase 2:

- Should the forecast scope default to committed work only, or to everything open including
  Backlog? (Recommendation: committed, with a checkbox for all open.)
- Is a 12-week default too long for a fast board, or too short for a slow one? The range control
  makes this cheap either way; a first run could pick by sample size.
- Is flow efficiency wanted enough to add the lane setting? If yes, it becomes Phase 3's first
  item, because it is the only one that needs a model change.

## Further reading

- Troy Magennis, *Forecasting and Coaching Using Data* (Crisp, 2019):
  <https://www.crisp.se/kurser/forecasting-and-coaching-using-data-november-6-2019>
- Planview, *Measuring and Reporting with Planview AgilePlace*:
  <https://blog.planview.com/measuring-and-reporting-with-leankit/>
- Planview, *Lean Metrics to Improve Flow*:
  <https://www.planview.com/resources/articles/lean-metrics-improve-flow/>
- Kanbanize / Businessmap, *Introduction to Kanban Metrics and Reporting*:
  <https://businessmap.io/kanban-resources/kanban-analytics>
- JiraMetrics, *Charts*, *Probabilistic Forecasting* and the *Quality Report*:
  <https://jirametrics.org/charts/>, <https://jirametrics.org/forecasting/>,
  <https://jirametrics.org/data_quality/>
