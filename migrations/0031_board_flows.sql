-- A board's lane trees become records of their own.
--
-- The old model told a tree apart by a two-value string on every lane, so a board had exactly one
-- cards tree and exactly one initiatives tree, and "the cards workflow" could only ever mean one
-- thing. A flow is now a row — id, board, kind, name and place — and a lane names it
-- (`lanes.flow_id`). That is what lets one board carry Delivery and Support as two independent
-- cards flows without either answering for the other, while still having one initiatives flow.
--
-- The backfill is the only correct one, because the old rows cannot mean anything else: every
-- board's `cards` lanes become one cards flow named "Cards", and its `initiatives` lanes one
-- initiatives flow named "Initiatives". Names belong to the board and can change later; the ids are
-- what lane walks and placements read, so they are written once, here.
--
-- `lanes.workflow` is *dropped*, not retired. Keeping it would leave two places saying what kind a
-- tree is, and the column is NOT NULL — every lane write after this would have to fill in a kind
-- that a flow already holds. The backfill reads it before it goes, and the index that carried it is
-- dropped first, because SQLite will not drop an indexed column.

CREATE TABLE IF NOT EXISTS board_flows (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id),
  board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS board_flows_board ON board_flows (board_id, kind, position);

ALTER TABLE lanes ADD COLUMN flow_id TEXT REFERENCES board_flows (id) ON DELETE CASCADE;

INSERT OR IGNORE INTO board_flows (id, workspace_id, board_id, kind, name, position)
SELECT 'flow-' || b.id || '-cards', b.workspace_id, b.id, 'cards', 'Cards', 0
FROM boards b;

INSERT OR IGNORE INTO board_flows (id, workspace_id, board_id, kind, name, position)
SELECT 'flow-' || b.id || '-initiatives', b.workspace_id, b.id, 'initiatives', 'Initiatives', 0
FROM boards b
WHERE EXISTS (SELECT 1 FROM lanes l WHERE l.board_id = b.id AND l.workflow = 'initiatives');

UPDATE lanes SET flow_id = 'flow-' || board_id || '-cards' WHERE workflow = 'cards';
UPDATE lanes SET flow_id = 'flow-' || board_id || '-initiatives' WHERE workflow = 'initiatives';
-- A lane that named neither kind is a lane the old model could not have written; it lands in the
-- board's cards flow rather than nowhere, so no card is stranded by the migration.
UPDATE lanes SET flow_id = 'flow-' || board_id || '-cards' WHERE flow_id IS NULL;

DROP INDEX IF EXISTS lanes_board;

ALTER TABLE lanes DROP COLUMN workflow;

CREATE INDEX IF NOT EXISTS lanes_flow ON lanes (flow_id, parent_id);
CREATE INDEX IF NOT EXISTS lanes_board ON lanes (board_id, flow_id);

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (31, 'board_flows');
