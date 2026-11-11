-- Objectives have a reading order within their period.
--
-- Before this, the list was whatever order the rows happened to be made in. A reader who wants
-- "this outcome first" had no way to say it, and the strategy map sorted by title instead. The
-- position is per period: two periods are read independently, and moving one objective never moves
-- another period's work.
--
-- Existing rows are placed in id order, which is the order the previous read used. A client that
-- predates ordering writes no position; the writer falls back to the document's order.

ALTER TABLE objectives ADD COLUMN position INTEGER;

UPDATE objectives SET position = (
  SELECT COUNT(*) FROM objectives AS earlier
  WHERE earlier.workspace_id = objectives.workspace_id
    AND earlier.period_id IS objectives.period_id
    AND earlier.id < objectives.id
);

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (49, 'objective_order');
