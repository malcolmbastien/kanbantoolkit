-- A template is a set of cards flows.
--
-- A board's design may now carry several cards flows, and a template that could only describe one
-- would silently drop the rest when a board is saved as one. A template flow is a row — key, kind,
-- name, place — and a template lane names it (`template_lanes.flow_key`).
--
-- The backfill is the only correct one: every template that existed described one tree, so it
-- becomes one cards flow named "Cards" and every lane names it. Names are the template's to change;
-- the key is what a lane points at.

CREATE TABLE IF NOT EXISTS template_flows (
  template_id TEXT NOT NULL REFERENCES board_templates (id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (template_id, key)
);

ALTER TABLE template_lanes ADD COLUMN flow_key TEXT;

INSERT OR IGNORE INTO template_flows (template_id, key, kind, name, position)
SELECT id, 'f0', 'cards', 'Cards', 0 FROM board_templates;

UPDATE template_lanes SET flow_key = 'f0' WHERE flow_key IS NULL;

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (32, 'template_flows');
