-- An invitation may say who it is for, not only which address.
--
-- Optional, and deliberately not shown by the public link: the link already masks the address so a
-- forwarded invitation does not name anybody. The name is used once the link is accepted — unless
-- the person gives their own, which always wins.

ALTER TABLE invites ADD COLUMN name TEXT;

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (29, 'invite_name');
