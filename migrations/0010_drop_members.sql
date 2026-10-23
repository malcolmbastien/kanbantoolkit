-- `members` answered two questions with one column. Both answers live in `instance_members` and
-- `workspace_members` now — 0008 copied every row before anything read the new tables — and nothing
-- reads this one. Dropped rather than left as a table that looks authoritative and is not.

DROP TABLE members;

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (10, 'drop_members');
