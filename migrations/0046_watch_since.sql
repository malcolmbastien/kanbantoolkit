-- A watch starts where it was made.
--
-- Watching a card is "tell me what happens next", not "show me everything that ever happened to
-- it". Each watch therefore carries the outbox position it began at, and the inbox reads events
-- **after** it. The position is per watch rather than a single per-person cursor: starting to watch
-- one card must not mark somebody else's unread events read.
--
-- Auto-watches (creator, newly assigned, note author) take the position as the write lands, so the
-- event that caused them is the first thing they see. An explicit Watch takes the position now, so
-- the card's history stays history.
--
-- Rows written before this column existed take the current maximum: the feature is new, and a
-- watch made before the rule should behave like one made under it. That is a one-time choice, not
-- a rule — a future migration must not silently advance a watch.

ALTER TABLE item_watch ADD COLUMN since_seq INTEGER NOT NULL DEFAULT 0;

UPDATE item_watch SET since_seq = (SELECT COALESCE(MAX(seq), 0) FROM outbound_events);

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (46, 'watch_since');
