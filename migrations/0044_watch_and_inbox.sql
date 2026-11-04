-- Watching a piece of work, and an inbox that reads the outbox.
--
-- A watch is one person's interest in one item, held by the instance rather than by a browser: a
-- card watched on a laptop is watched on a phone, and a person who leaves the board still has the
-- inbox waiting. There is deliberately no board, filter or dependency subscription — a watch is
-- about a piece of work, not a view of the board.
--
-- The inbox is not a second history. It is a cursor over `outbound_events`, the record the
-- workspace already writes for webhooks, so a change has one place to be read from and cannot
-- drift from what a receiver was told. That needs two things the outbox did not carry:
--
--   * `seq` — a position for a reader. The event's public id is a UUID because it is a contract
--     with a receiver; a reader needs an order, and a UUID has none.
--   * `item_id` — which item the event is about, resolved when it is emitted (`itemId`, or an
--     initiative's `initiativeId`). Reading the payload with JSON in every inbox query would make
--     the one indexed read a scan, and the inbox is asked for by every bell.
--
-- Events written before this migration keep `item_id` NULL: nobody had a watch then, so they are
-- not anybody's inbox. `seq` is backfilled from the table's own rowid, which is the order they
-- were written in.
--
-- The cursor is per person per workspace, not per browser. "Mark all read" moves it, and the
-- unread count is everything for a watched item after it. A watch and a cursor are both removed
-- with the item or the person they point at — a dead watch is not a row anybody can read.

ALTER TABLE outbound_events ADD COLUMN seq INTEGER;
ALTER TABLE outbound_events ADD COLUMN item_id TEXT;

UPDATE outbound_events SET seq = rowid WHERE seq IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS outbound_events_seq ON outbound_events (seq);
CREATE INDEX IF NOT EXISTS outbound_events_item ON outbound_events (workspace_id, item_id, seq);

CREATE TABLE IF NOT EXISTS item_watch (
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, item_id)
);

CREATE INDEX IF NOT EXISTS item_watch_item ON item_watch (workspace_id, item_id);
CREATE INDEX IF NOT EXISTS item_watch_person ON item_watch (workspace_id, user_id);

CREATE TABLE IF NOT EXISTS inbox_cursor (
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  last_seen_event_seq INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, user_id)
);

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (44, 'watch_and_inbox');
