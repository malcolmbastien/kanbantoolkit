-- When a card is due: one day, and a promise.
--
-- The target start/end pair beside it is the plan a management surface reads — a span a piece of
-- work is scheduled across. This is the single date a reader is held to, and the one "overdue"
-- speaks about, so it is a column of its own rather than a reuse of either end of the window: a
-- card can be planned across a quarter and promised for one day, and one field cannot say both.
--
-- Optional, and nullable on purpose: a row that predates it is a card with no promise, not a card
-- due on the day it was created. An initiative carries one too — the no-estimate rule is about
-- size, not deadlines — so nothing here reads the item's type.

ALTER TABLE items ADD COLUMN due_date TEXT;

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (40, 'item_due_date');
