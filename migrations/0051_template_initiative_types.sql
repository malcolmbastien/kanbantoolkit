-- A template's initiative kinds: the labels a board made from it starts with.
--
-- They are a board's own vocabulary, not the workspace's, and a template is a design rather than a
-- board — so they hang from the template, exactly as `board_initiative_types` hangs from a board.
CREATE TABLE IF NOT EXISTS template_initiative_types (
  template_id TEXT NOT NULL REFERENCES board_templates (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (template_id, id)
);

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (51, 'template_initiative_types');
