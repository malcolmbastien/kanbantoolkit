-- A change made through a token can say which token.
--
-- The log names the person whose account acted, and an agent acts as its owner: without this line a
-- script's edit and a person's edit read the same sentence. The name is the token's, written by the
-- server — never sent by a client, so a card cannot claim to have been changed by an agent it was
-- not — and absent on everything that happened at the board.
--
-- The column goes on the log rather than on the card: the same card is edited by a person and by an
-- automation on the same afternoon, and the history is where the difference is read.

ALTER TABLE item_log ADD COLUMN via TEXT;

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (42, 'item_log_via');
