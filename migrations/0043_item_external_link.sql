-- A card can name where its work lives elsewhere.
--
-- A ticket in another tracker, a design file, a contract: two fields, a label the team chose and the
-- address it points at. Optional, so a row that predates it is a card with no link rather than an
-- empty chip — the same shape the target dates and the due date arrived in.
--
-- The address is validated where it is written (http/https only, in `src/domain/externalLink.ts`),
-- and nothing in this schema makes the app fetch it: the link is a reference the reader presses,
-- never a preview or an icon pulled from the other system.

ALTER TABLE items ADD COLUMN external_label TEXT;
ALTER TABLE items ADD COLUMN external_url TEXT;

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (43, 'item_external_link');
