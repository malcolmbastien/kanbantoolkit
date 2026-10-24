-- A third door: the domains an administrator is willing to admit without an invitation.
--
-- Exact matches only, evaluated against a verified address, and it admits a viewer — never an
-- administrator. It is a door, so changing it is an audited act like opening or closing the instance.
--
-- Stored as JSON in the settings row rather than as a table: it is a short list that is read whole
-- and written whole, and nothing joins to it.

ALTER TABLE instance_settings ADD COLUMN allowed_domains TEXT NOT NULL DEFAULT '[]';

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (15, 'allowed_domains');
