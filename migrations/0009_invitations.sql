-- An invitation is a link, a session is a record, and access leaves a trail.

-- The table until now was a note about an email address, which is not something a person can
-- accept: it had no token, so it could never become a link. The rows are dropped rather than kept
-- as something the interface would have to explain. (Reissuing on first read would need code the
-- schema cannot run; task 132.3 records the choice.)
CREATE TABLE invites_next (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('viewer', 'editor', 'admin')),
  -- The token lives in the link that is handed over. This is its hash, so a copy of the database is
  -- not a set of working invitations.
  token_hash TEXT UNIQUE,
  invited_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT
);
DROP TABLE invites;
ALTER TABLE invites_next RENAME TO invites;
CREATE INDEX invites_email ON invites (email);

-- A session gains what a person needs to recognise it in a list, and revocation becomes a fact
-- rather than a disappearance: a row that is deleted cannot be shown, and "sign out everywhere"
-- is a list somebody reads.
ALTER TABLE sessions ADD COLUMN user_agent TEXT;
ALTER TABLE sessions ADD COLUMN ip_hash TEXT;
ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;
ALTER TABLE sessions ADD COLUMN revoked_at TEXT;

-- Who did what to whom. No card titles, no addresses beyond a hash: a log that copies the workspace
-- is a second copy of the workspace.
CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  data TEXT,
  ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS audit_events_at ON audit_events (at);
CREATE INDEX IF NOT EXISTS audit_events_actor ON audit_events (actor_id, at);

-- Append-only, enforced rather than promised: a record that can be edited is not a record.
CREATE TRIGGER IF NOT EXISTS audit_events_no_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_events_no_delete BEFORE DELETE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (9, 'invitations');
