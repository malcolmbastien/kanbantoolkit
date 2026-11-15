-- A board's own activity stream. It is not an item log: a card event carries only the item id,
-- a deletion carries no card at all, and design changes are board-level sentences.
CREATE TABLE IF NOT EXISTS board_activity (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  actor_id TEXT,
  via TEXT,
  kind TEXT NOT NULL,
  item_id TEXT,
  summary TEXT
);

CREATE INDEX IF NOT EXISTS board_activity_page
  ON board_activity (workspace_id, board_id, at DESC, id DESC);

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (50, 'board_activity');
