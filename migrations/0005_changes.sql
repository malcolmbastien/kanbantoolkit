-- Every accepted change, in the order it was accepted.
--
-- This is the feed a second device reads: the websocket and the poll are two transports over this
-- one table, so neither has to invent what "a change" means. `id` is the cursor a client keeps; it
-- is monotonic, and a client that has been away catches up by asking for everything after it.
--
-- Append-only, and deliberately not pruned yet: a row is four small values, and a client with a
-- stale cursor would silently miss what was removed. Retention arrives with the audit work, where
-- "how long do we keep it" is asked once rather than twice.

CREATE TABLE IF NOT EXISTS changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  rev INTEGER NOT NULL,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS changes_at ON changes (at);
