-- Who made a card or an initiative.
--
-- Until now the only record of a creator was the item's own log: the first `created` entry carries
-- the person who wrote it, when the person was known. That is a history, not a field — reading it
-- means walking an entry list, and an agent asking for an item got no answer at all.
--
-- So the answer gets a column, filled once when the item is made and never written again: it records
-- an act that has already happened. `createdById` in the API is read-only for the same reason, and a
-- patch that carries one is refused rather than obeyed.
--
-- Existing rows are backfilled from their own log, which is where the answer already was. An item
-- whose log says nothing stays NULL: a name invented for it would be a guess dressed as a fact.

ALTER TABLE items ADD COLUMN created_by_id TEXT;

UPDATE items
SET created_by_id = (
  SELECT l.by_user
  FROM item_log l
  WHERE l.item_id = items.id AND l.kind = 'created' AND l.by_user IS NOT NULL
  ORDER BY l.at ASC
  LIMIT 1
)
WHERE created_by_id IS NULL;

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (27, 'item_creator');
