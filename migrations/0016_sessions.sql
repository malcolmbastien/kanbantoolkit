-- Sessions a person can recognise, and a lifetime that depends on what the sign-in asked for.
--
-- The row id stays the SHA-256 of the token — a copy of this table is not a set of working
-- sessions — so a session needs a *public* name of its own before a person can revoke it: the id
-- is a credential's fingerprint, and handing it back to the browser would be handing back half the
-- secret. `public_id` is what `/api/me/sessions` returns and what a revoke names.
ALTER TABLE sessions ADD COLUMN public_id TEXT;
UPDATE sessions SET public_id = lower(hex(randomblob(9))) WHERE public_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sessions_public ON sessions (public_id);

-- Whether the sign-in asked to be remembered. Carried through the OAuth round trip, because the
-- callback issues the session and the choice was made before the browser left.
ALTER TABLE oauth_states ADD COLUMN remember INTEGER NOT NULL DEFAULT 0;

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (16, 'sessions');
