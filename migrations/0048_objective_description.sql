-- An objective can say what it means in its own words.
--
-- The key results say what the objective is for and the completeness is read from the work below
-- it; neither is the sentence a reader needs to understand the intent. The description is that
-- sentence: optional, written on the objective itself, and never measured. An objective without
-- one is still complete.

ALTER TABLE objectives ADD COLUMN description TEXT;

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (48, 'objective_description');
