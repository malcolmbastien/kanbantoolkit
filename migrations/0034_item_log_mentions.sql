-- A note can mention people, and the note remembers who they are.
--
-- The typed `@Name` stays in `note`; this column holds the user ids behind it, so a rename changes
-- the name on every surface at once and a removed account can still be called "Former member".
-- A mention is part of the note, not a thread: there is no parent, no reply and no second entity.
--
-- Existing notes are NULL, which reads as "nobody was named" — the honest answer for a history
-- written before mentions existed.

ALTER TABLE item_log ADD COLUMN mentions TEXT;

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (34, 'item_log_mentions');
