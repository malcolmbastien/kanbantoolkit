-- Finished work is filed after a week, and nobody chooses the week.
--
-- A card that reached Done sat on its board until a workspace setting said how long. That made a
-- product decision configurable: one instance kept finished work for a fortnight and another for a
-- year, so a person reading a board could not know when a finished column would empty itself. It
-- was also the only entry in the workspace's vocabulary that was not a word about the work.
--
-- The age is now a constant (`AUTO_ARCHIVE_DAYS` in `src/domain/autoArchive.ts`): seven days after
-- it is done, finished work is *archived* — not deleted, and restorable from the Archive at any
-- time, which is why the length of the wait does not need to be a choice.
--
-- It is gone from the model, not hidden: the vocabulary document no longer carries it, Board
-- settings no longer asks, and no code reads the value. The column goes with the field. A number
-- nobody reads is a number that will be read again by mistake — by a report, a query, or the next
-- person to open the table.
--
-- Nothing else moves: the workspace's row keeps its board, its saved filters and its collapsed
-- lanes, and its vocabulary revision is untouched.

ALTER TABLE workspace DROP COLUMN auto_archive_days;

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (41, 'fixed_auto_archive');
