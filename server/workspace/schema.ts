/**
 * The shape of a workspace as this server writes it.
 *
 * The browser keeps its own number, deliberately separate: this one says what the server can produce,
 * the other says what the client can render, and a mismatch is a real disagreement rather than
 * duplication. Task 118.7 owns the discipline that moves them together — bump on a schema change,
 * migrate forward, refuse rather than guess.
 */
export const WORKSPACE_SCHEMA = 1

/**
 * The migration this code needs its database to have run.
 *
 * Not the same number as `WORKSPACE_SCHEMA`: that one is the shape of the payload, this one is the
 * state of the schema behind it. A database below this is refused rather than served, which is R2's
 * "run before the new code serves a request" said by the code that would otherwise guess.
 *
 * 21 is the bill leaving the schema (task 166). A database that still carries the billing columns is
 * one this code has stopped reading, so the rule is the same: refuse rather than guess.
 *
 * 22 is the password column (task 154.3): a database without it cannot sign anybody in, which is a
 * read this code must not attempt. 23 adds the magic-link table (154.7), for the same reason: a route
 * that offers a link must not fail on a database that has no table to put it in.
 *
 * 24 adds the machine credentials (task 148): the token and device-code tables. The bearer door reads
 * them on every request, so a database without them would answer 401 to a credential that is valid.
 * 25 adds SCIM (task 168): the provisioning token and the IdP's own id for a person. The `/scim/v2`
 * door reads both, so the same rule — refuse rather than guess.
 *
 * 26 drops `items.size`: the board stopped counting points, and a database that still carries the
 * column is one this code has stopped reading. It is not an additive read like the ones above, which
 * is exactly why the number moves: a self-hoster on 25 is served by code that would ignore a field
 * their rows still hold, and the honest answer is to migrate, not to half-read it.
 *
 * 27 adds `items.created_by_id`, and backfills it from `item_log`. It is additive, and the backfill
 * is the reason the number moves: a database that has not run it answers "nobody" for work whose log
 * says otherwise, and a half-answer is worse than a refusal to serve until it is upgraded.
 *
 * 28 adds `workspace_structure`: the revision of the board design, which the design write checks
 * before it replaces a board. A database without it would refuse every design write as stale, which
 * is a read this code cannot make honestly — so a database behind it is refused at the door instead.
 *
 * 29 adds `invites.name`: the optional name an administrator gives when they make a link. A database
 * without it cannot write the invitation this code offers, so the same rule applies.
 *
 * 30 adds `items.discarded`: whether a filed-away item's work was done. A database without it cannot
 * record the difference between an archive and a discard, which is the whole point of the column —
 * so it is refused at the door rather than served with every discard written down as completed.
 *
 * 31 adds `board_flows` and `lanes.flow_id`, and retires `lanes.workflow`: a lane names the tree it
 * is in, and a board may now carry several cards flows. A database without them cannot be read at
 * all — every lane walk resolves a flow — so the same rule applies: migrate, or be refused.
 *
 * 32 adds `template_flows` and `template_lanes.flow_key`: a template describes a set of cards flows.
 * A database without them would hand back a template whose lanes belong to no flow, which the
 * editor cannot draw — refused rather than half-read, like every number before it.
 *
 * 33 adds `workspace.vocabulary_rev`: the revision of the workspace's words — types, templates,
 * objectives and key results — which the app writes as one document. A database without it cannot
 * refuse a stale write, so it is refused at the door instead of letting two people overwrite each
 * other's vocabulary without either being told.
 *
 * 34 adds `item_log.mentions`: the people a note names, as user ids. A database without it cannot
 * store a mention, so a note would be written with its words but without the identity behind them —
 * a half-answer worse than refusing to serve until the migration runs.
 *
 * 35 adds the outbound event layer: events, endpoints and deliveries. A database without them
 * cannot record that a change happened for a receiver, and a webhook that silently drops events is
 * worse than one that says it is not configured — so the same rule applies.
 *
 * 36 adds `periods`, and moves an objective's period from a label to `objectives.period_id`;
 * `objectives.period` and `objectives.score` are dropped. A database without it cannot commit an
 * objective to a window, and would keep answering with a score the app no longer reads — refused
 * rather than half-read, like every number before it.
 *
 * 37 adds the indexes the v1 listings page over: a workspace's boards and items by id, a type
 * filter, the placement a card is listed by, and the change row `updatedSince` asks for. They are
 * performance, not shape, but they arrive with the code that needs them so a large workspace is
 * not listed by loading it first.
 *
 * 38 gives a change its workspace. A shared instance's feed was scoped by a join through items;
 * the change now names the workspace itself, so the feed filter is indexed and one tenant's cursor
 * cannot see another tenant's row. Existing ids are kept, because they are client cursors.
 *
 * 39 adds `board_flows.description`: the optional line under a workflow's name. A database without
 * it cannot store what the board says its workflow is for; the column is nullable, and a row with
 * no line is a workflow with no line. Refused at the door like every shape before it.
 *
 * 40 adds `items.due_date`: the single day a piece of work is promised for, beside the target
 * window that is its plan. A database without it cannot store the promise, and "overdue" would
 * have nothing of its own to read — the same reason every number before it moved.
 *
 * 41 drops `workspace.auto_archive_days`: how long finished work stays on a board is the product's
 * constant now, not a workspace setting. A database that still carries the column is one this code
 * has stopped reading, which is the case the number exists to refuse — like `items.size` at 26.
 *
 * 42 adds `item_log.via`: the token an agent or a script acted with, so a history can tell a
 * person's edit from a token's on the same card. A database without it cannot record the difference,
 * and a column the code writes but the shape lacks is a write that fails — refused at the door.
 *
 * 43 adds `items.external_label` and `items.external_url`: where a card's work lives elsewhere. A
 * database without them cannot store the link the drawer offers, so the same rule applies.
 *
 * 44 adds the watch and the inbox: `item_watch`, the per-person cursor, and the outbox's `seq` and
 * `item_id`. Without them the bell has nothing to read and a watch has nowhere to live — and the
 * outbox writes the two columns, so a database lacking them cannot record an event at all.
 *
 * 45 adds mail delivery: the two preference columns and the digest's own cursor. A database without
 * them cannot say whether a person asked for email, and the profile read names both — refused at
 * the door rather than answered with an invented default.
 *
 * 46 adds `item_watch.since_seq`: the outbox position a watch began at. The inbox reads after it, so
 * watching a card shows what happens next rather than its whole history. A database without it
 * would answer every watch with the past — the behaviour this column exists to stop.
 *
 * 47 moves an objective's stored state to the lifecycle vocabulary — a reviewed objective becomes
 * archived. A database that has not run it would read those rows as active, which is the wrong
 * statement about work that has been closed.
 *
 * 48 adds `objectives.description`: the sentence that says what an objective means, beside its key
 * results. A database without it has nowhere to keep that sentence, so the write is refused rather
 * than silently dropping it.
 *
 * 49 adds `objectives.position`: the reader's order inside a period. A database without it cannot
 * keep the order the page shows, and the strategy map would fall back to sorting by title.
 */
export const REQUIRED_SCHEMA = 49
