-- The change feed belongs to a workspace.
--
-- Every change names an item, and an item belongs to one workspace, so the feed was scoped by a
-- join through items. That works until the table has more than one tenant's writes in it: the join
-- is the filter, and the index cannot see past it. The workspace is now a column on the change
-- itself, backfilled from the item that caused it.
--
-- Existing ids are untouched: they are the client cursors, and renumbering them would make every
-- client re-read a workspace it had already caught up with. A change whose item is gone cannot be
-- attributed to a workspace; it is left with a null, and the scoped feed never returns it.
--
-- New rows must name a workspace, so a writer cannot add another tenant's change to the feed.

ALTER TABLE changes ADD COLUMN workspace_id TEXT REFERENCES workspaces (id);

UPDATE changes
   SET workspace_id = (SELECT i.workspace_id FROM items i WHERE i.id = changes.item_id)
 WHERE workspace_id IS NULL;

CREATE INDEX IF NOT EXISTS changes_workspace ON changes (workspace_id, id);

CREATE TRIGGER IF NOT EXISTS changes_needs_workspace_insert BEFORE INSERT ON changes
WHEN NEW.workspace_id IS NULL
BEGIN SELECT RAISE(ABORT, 'a change belongs to a workspace'); END;

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (38, 'changes_workspace');
