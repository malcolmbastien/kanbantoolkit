-- A workflow can say what it is for.
--
-- The line under a workflow's name used to be fixed prose in the app — "the team's flow — drag
-- cards between lanes". It is now the board's own, optional line: a board that wants no line has
-- none, and a board that wants to explain a workflow can. The column is nullable, and old rows read
-- as no line, which is the honest backfill — no sentence was ever stored for them.

ALTER TABLE board_flows ADD COLUMN description TEXT;

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (39, 'flow_descriptions');
