-- A write that was applied, so a retry after a lost response cannot apply it again.
--
-- The key is made by the client and names one change, not one attempt: a queue that retries sends
-- the same key, and the server answers with what is stored rather than doing the work twice. The
-- table is pruned on every keyed write, so it holds about a day of changes rather than every change
-- ever made.

CREATE TABLE IF NOT EXISTS applied_writes (
  key TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  rev INTEGER NOT NULL,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS applied_writes_at ON applied_writes (at);
