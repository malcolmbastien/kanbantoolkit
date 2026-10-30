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
 */
export const REQUIRED_SCHEMA = 33
