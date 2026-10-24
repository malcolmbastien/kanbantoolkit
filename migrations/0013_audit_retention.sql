-- The trail gains what a record needs: an actor that can be forgotten without the row going with it,
-- and a retention window that is the one thing allowed to remove a row.
--
-- Rebuilt rather than altered because SQLite cannot add a foreign key in place. The rows are copied
-- whole — an id, an actor, an action, a target — so nothing is lost by the rebuild.

CREATE TABLE audit_events_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Nobody, for something the system did; and NULL again if the person is ever deleted, so the
  -- event survives the account it names.
  actor_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  data TEXT,
  ip_hash TEXT
);

INSERT INTO audit_events_next (id, at, actor_id, action, target_type, target_id, data, ip_hash)
  SELECT id, at, actor_id, action, target_type, target_id, data, ip_hash FROM audit_events;

DROP TABLE audit_events;
ALTER TABLE audit_events_next RENAME TO audit_events;

CREATE INDEX IF NOT EXISTS audit_events_at ON audit_events (at);
CREATE INDEX IF NOT EXISTS audit_events_actor ON audit_events (actor_id, at);

-- Editing a record is never allowed. Removing an old one is: `pruneAudit` is the only code that
-- deletes, it takes one statement, and it is bounded by the retention window.
--
-- The trigger names the columns rather than the row, because one legitimate update exists: the
-- foreign key nulls `actor_id` when the person is deleted. That is the record outliving the account,
-- not an edit — so it is allowed, and nothing else on the row is.
CREATE TRIGGER IF NOT EXISTS audit_events_no_edit
BEFORE UPDATE OF at, action, target_type, target_id, data, ip_hash ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;

CREATE TRIGGER IF NOT EXISTS audit_events_actor_only_nulled
BEFORE UPDATE OF actor_id ON audit_events
WHEN NEW.actor_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (13, 'audit_retention');
