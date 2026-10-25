-- Machine credentials (task 148).
--
-- A person signs in and gets a session cookie. A *tool* cannot: a cron job has no browser, an agent
-- started from a shell has no cookie jar, and a CI step that owned somebody's session could do
-- everything they can. So a token: minted once, shown once, stored as SHA-256, scoped from the
-- matrix in `src/domain/roles.ts`, expiring, revocable, and never stronger than the person who owns
-- it — because every request still asks what their role is *now*.
--
-- Columns worth explaining rather than reading twice:
--
-- * `scopes` is a JSON array of the closed vocabulary in `src/domain/scopes.ts`. A token with no
--   scopes reaches nothing; there is no "all" spelling to get wrong.
-- * `expires_at` is required in practice (90 days unless the person chose otherwise) but nullable,
--   because an administrator minting a daemon's credential for a machine nobody will revisit is a
--   real case, and an expiry nobody remembers to extend is an outage.
-- * `origin` is how it arrived, and the list screen says so: `self` (the person, in their profile),
--   `admin` (an administrator, for somebody else — CI and daemons), `device` (approved through the
--   short code a tool printed).
-- * `minted_by` is the actor for the audit trail, and is not the owner for the `admin` origin.
--   `ON DELETE SET NULL` because removing an administrator must not remove the credential of the
--   daemon they set up.

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL,
  expires_at TEXT,
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  origin TEXT NOT NULL CHECK (origin IN ('self', 'admin', 'device')),
  minted_by TEXT REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS api_tokens_user ON api_tokens (user_id);

-- The short-code half of the device flow (task 148, R7/R10).
--
-- A tool that has no way to receive a redirect asks for a code: it keeps the long `code_hash` and
-- prints the short `user_code`. A person who is already signed in opens the URL, is shown the tool's
-- name and the scopes in words, and approves. The tool polls with its own code and receives the
-- secret exactly once — so the secret never passes through a clipboard, a shell history or a chat
-- message.
--
-- `user_id` and `approved_at` are the approval; `used_at` is the one exchange. A code is single-use
-- in both directions: approving twice is refused, and so is exchanging twice.
CREATE TABLE IF NOT EXISTS device_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  user_code TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  scopes TEXT NOT NULL,
  approved_at TEXT,
  used_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- The asking address, hashed the way the sign-in limiter counts it: a code is unauthenticated, so
  -- one address may not fill the table. Never an address in the clear.
  ip_hash TEXT
);

CREATE INDEX IF NOT EXISTS device_codes_expiry ON device_codes (expires_at);
CREATE INDEX IF NOT EXISTS device_codes_ip ON device_codes (ip_hash, created_at);

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (24, 'api_tokens');
