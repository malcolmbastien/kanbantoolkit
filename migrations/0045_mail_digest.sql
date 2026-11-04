-- Delivering what a person watches: a preference, and the position the last digest reached.
--
-- Delivery is opt-in. A deployment with no relay does not offer it at all, so the default is off:
-- the inbox has always recorded what happened, and turning email on is a person's decision rather
-- than something an instance starts doing on their behalf.
--
-- `mail_frequency` is one of `immediate`, `daily` or `weekly`. It is a word rather than a number of
-- minutes because a person chooses a rhythm, not a schedule, and the reader's time zone is already
-- on `users` — "daily at 08:00" means their morning.
--
-- `mail_state` is the digest's own cursor, separate from the inbox's. A digest is "since the last
-- one", not "since you last opened the bell": opening the inbox must not silence tomorrow's mail,
-- and receiving a digest must not mark the inbox read.
--
-- The cursor is per person per workspace because both the watch list and the outbox are.

ALTER TABLE users ADD COLUMN mail_on INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN mail_frequency TEXT NOT NULL DEFAULT 'daily'
  CHECK (mail_frequency IN ('immediate', 'daily', 'weekly'));

CREATE TABLE IF NOT EXISTS mail_state (
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  last_sent_at INTEGER NOT NULL DEFAULT 0,
  last_sent_seq INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, user_id)
);

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (45, 'mail_digest');
