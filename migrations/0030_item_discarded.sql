-- A filed-away item says whether its work was done.
--
-- The archive keeps one fact about an item, not the column it happened to sit in: finished work is
-- archived, unfinished work is discarded, and both leave the board the same way. The field is only
-- ever set for the discarded case, so a row that carries it is work nobody will do.
--
-- NULL is not "completed" here: it is "nobody said". Rows filed before the column existed keep that
-- honest answer, and the client reads it from the item's placement — filed from a Done column, it
-- was finished; filed from anywhere else, it was discarded.

ALTER TABLE items ADD COLUMN discarded INTEGER;

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (30, 'item_discarded');
