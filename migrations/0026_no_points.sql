-- The board stops counting points.
--
-- A card carried `size` — an estimate in points — and an initiative had none of its own: its size
-- was the sum of the sizes of the work below it, and a percentage was the delivered part of that
-- sum. Two numbers, both entered by hand, both of which a team had to agree on before the board
-- said anything true about how far along the work was.
--
-- It is gone from the model, not hidden: the drawer no longer asks, no card shows one, the API no
-- longer accepts or returns one, and a rollup is the number of issues done over the number of
-- issues below. A count is a fact about the board; a point is an opinion about the work, and the
-- two disagreed often enough that the board stopped asking.
--
-- The column goes with the field. A number nobody reads is a number that will be read again by
-- mistake — by a report, an import, or the next person to write a query.
--
-- Nothing else moves: titles, descriptions, types, people, tags, dates, checklists and every card's
-- own history stay exactly where they are.

ALTER TABLE items DROP COLUMN size;

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (26, 'no_points');
