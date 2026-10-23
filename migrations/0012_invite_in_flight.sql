-- A sign-in can carry an invitation token, so the callback knows which link brought this person.
-- One column on the row that already holds a sign-in in flight: the token is read once, spent once,
-- and forgotten with the row when the callback lands.

ALTER TABLE oauth_states ADD COLUMN invite TEXT;

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (12, 'invite_in_flight');
