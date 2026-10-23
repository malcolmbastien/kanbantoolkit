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
 */
export const REQUIRED_SCHEMA = 12
