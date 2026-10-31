-- The v1 listings answer in SQL, so their filters and their page order need indexes.
--
-- The boards list walks one workspace's boards by id. The items list walks one workspace's items
-- by id, optionally narrowed by type, and joins the card's last placement (the one the listing
-- names) before filtering by board or by a lane subtree. `placements_board` and `placements_item`
-- already carry the join; `placements_lane` gives the lane filter a way in from the other side.
--
-- `updatedSince` asks whether a card has a change after a timestamp, which is a lookup on the
-- change row rather than a scan of the feed.

CREATE INDEX IF NOT EXISTS boards_workspace_id ON boards (workspace_id, id);
CREATE INDEX IF NOT EXISTS items_workspace_id ON items (workspace_id, id);
CREATE INDEX IF NOT EXISTS items_workspace_type ON items (workspace_id, type_id, id);
CREATE INDEX IF NOT EXISTS placements_lane ON placements (lane_id, item_id);
CREATE INDEX IF NOT EXISTS changes_item_at ON changes (item_id, at);

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (37, 'listing_indexes');
