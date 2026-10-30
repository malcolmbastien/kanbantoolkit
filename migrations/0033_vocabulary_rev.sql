-- The workspace's words keep a revision of their own.
--
-- Issue types, templates, objectives and key results are one document the app writes as a whole,
-- and refusing a stale sender needs a number to compare — the same shape the board design has.
-- It is a revision beside `workspace_structure.rev`, not shared with it: two administrators
-- renaming a card type and moving a lane are unrelated acts, and one counter would refuse the
-- second for no reason.
--
-- The settings row already exists (it is created with the workspace), so this is a column on it.

ALTER TABLE workspace ADD COLUMN vocabulary_rev INTEGER NOT NULL DEFAULT 0;

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (33, 'vocabulary_rev');
