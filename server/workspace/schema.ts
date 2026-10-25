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
 */
export const REQUIRED_SCHEMA = 24
