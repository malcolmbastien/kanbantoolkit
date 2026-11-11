-- An objective's state is a lifecycle: draft, active, archived, cancelled.
--
-- `reviewed` — and the older `scored` before it — named the state after a period had been reviewed
-- and closed. That is the state the app now calls `archived`; a cancelled objective is the one that
-- was dropped instead. The read and validation paths also understand the old words, so a client
-- that has not reloaded cannot write one back, but the stored rows move with the vocabulary.

UPDATE objectives SET status = 'archived' WHERE status IN ('reviewed', 'scored');

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (47, 'objective_statuses');
