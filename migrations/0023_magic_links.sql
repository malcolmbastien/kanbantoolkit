-- A link that signs you in, and a link that lets you set a password.
--
-- Both are the same mechanism with two intentions (task 154.7): a token, sent to an address, that is
-- single-use, short-lived and hashed at rest exactly as a session is. The `signin` purpose signs the
-- person in; the `reset` purpose signs them in and the app immediately asks for a new password.
--
-- Why a link at all: a deployment with a mail relay can offer sign-in without a password to remember,
-- and a person who has forgotten theirs can get back in without an administrator's help. A deployment
-- with no relay has neither, and an administrator mints the same reset link by hand (which is why the
-- table does not care who created the row).
--
-- The row holds an address rather than a user id: the account is looked up when the link is used, so a
-- link minted for somebody who was removed in the meantime simply finds nothing.

CREATE TABLE IF NOT EXISTS magic_links (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  -- The hash of the token, never the token: a database read is not a set of working links.
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('signin', 'reset')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Who asked, hashed the way an audit entry's address is. Never an address in the clear.
  ip_hash TEXT
);

CREATE INDEX IF NOT EXISTS magic_links_email ON magic_links (email);

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (23, 'magic_links');
