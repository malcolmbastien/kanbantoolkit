-- SCIM (task 168): an identity provider that provisions the team.
--
-- Two things, and they are both about an external system acting without a person behind it:
--
-- * `scim_tokens` — a credential an IdP sends as `Authorization: Bearer …`. It is not a session and
--   not an API token: it can provision, it cannot read a board, and it carries the **workspace role**
--   a provisioned person gets (editor by default). It is named, so two IdPs can be told apart and one
--   revoked without the other, and it is stored as a hash, so a database read is not a working
--   credential.
-- * `users.external_id` — the IdP's own id for the person, kept so the IdP can find them again even
--   if the address changes. It is the first thing a provisioning client asks for after `userName`.

CREATE TABLE IF NOT EXISTS scim_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  -- The seat a provisioned person gets. A workspace role, never an instance one: a directory may
  -- make somebody an editor of this team; it may not make them the administrator of the deployment.
  default_role TEXT NOT NULL CHECK (default_role IN ('viewer', 'editor', 'admin')),
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  minted_by TEXT REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS scim_tokens_hash ON scim_tokens (token_hash);

ALTER TABLE users ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_external_id ON users (external_id) WHERE external_id IS NOT NULL;

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (25, 'scim');
