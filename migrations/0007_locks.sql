-- One row per card someone holds, and nothing else.
--
-- `item_id` is the primary key, so two holders cannot both be right: the race is settled by the
-- database rather than by two clients agreeing. A lease lives a minute and is renewed while
-- somebody is actually there, because a browser that vanishes must not strand a card.
--
-- Keyed by user *and* session: two tabs of one person are two sessions, and the second is told
-- "open in another tab" rather than being locked out by itself.

CREATE TABLE IF NOT EXISTS locks (
  item_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  holder_name TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS locks_expiry ON locks (expires_at);

-- Every migration after 0006 records itself, so the version and the schema cannot disagree.
INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (7, 'locks');
