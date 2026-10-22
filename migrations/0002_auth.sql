-- People, the doors they came through, the sessions they hold, and the invitations waiting for them.
--
-- Plain SQLite, like everything else here: the same file applies to D1 and to a self-hosted file.
-- The address is what joins two doors to one person, so it is unique and stored lowercased.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (lower(email));

-- One row per provider account. The pair (provider, subject) is what the provider promised, and it
-- is stable even if someone changes their address there.
CREATE TABLE IF NOT EXISTS identities (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  email TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (provider, subject)
);
CREATE INDEX IF NOT EXISTS identities_user ON identities (user_id);

-- The id is the SHA-256 of the token, never the token: a copy of this table is not a set of
-- working sessions.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

-- A membership says someone may use this instance. The first person to arrive owns it; everyone
-- else arrives as a member, or with the role an invitation gave them.
CREATE TABLE IF NOT EXISTS members (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- An invitation is an address waiting to arrive; it is spent the first time that address signs in.
CREATE TABLE IF NOT EXISTS invites (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'member',
  invited_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- A sign-in in flight: the state, the PKCE verifier, and where to go afterwards. Single use.
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  verifier TEXT NOT NULL,
  next TEXT NOT NULL DEFAULT '/',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Sign-in attempts, so a flood costs an attacker something. The address is stored hashed.
CREATE TABLE IF NOT EXISTS auth_attempts (
  ip_hash TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS auth_attempts_window ON auth_attempts (ip_hash, at);
