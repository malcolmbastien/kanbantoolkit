-- The server's schema version, and the record of how it got there.
--
-- `schema_migrations` is the server's `PERSIST_VERSION`: one row per migration that has run, written
-- by the migration itself so a database migrated by wrangler and one migrated by the Node runner
-- agree without either of them trusting the other's bookkeeping.
--
-- Everything before this file was applied before the table existed, so this file backfills them. A
-- fresh database runs this after the first five and ends at 6; an existing one ends at 6 too, and
-- the `INSERT OR IGNORE` makes running it twice harmless.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES
  (1, 'errors'),
  (2, 'auth'),
  (3, 'workspace'),
  (4, 'applied_writes'),
  (5, 'changes'),
  (6, 'schema_migrations');
