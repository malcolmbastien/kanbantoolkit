-- The workspace becomes a row, and every entity names it.
--
-- Until now the workspace was a constant: `workspace` was the id of the settings row, and the work
-- itself — boards, lanes, items, the people in them — belonged to the instance rather than to
-- anything. Task 122 gives it an identity of its own: one row, and a `workspace_id` on every table
-- that holds work, so a second workspace is a row rather than a fork.
--
-- The backfill is the whole migration's point: every existing row joins the one workspace this
-- instance already had, and nothing is dropped or guessed at.
--
-- Two constraints, honestly stated. SQLite will not add a `REFERENCES` column that has a non-NULL
-- default, and the app's `Database.batch` runs each migration inside one transaction — so the
-- thirteen-table rebuild that would give a literal `NOT NULL` cannot be done with foreign keys
-- enforced, on either runtime. What this migration does instead is: add the column with its foreign
-- key, backfill every row, and add **triggers** that refuse an insert or an update that leaves it
-- empty. The behaviour the task asks for is enforced; only the `PRAGMA`-visible word differs, and a
-- test asserts the behaviour rather than the word.

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- The settings row is deliberately not given a second column: its primary key *is* the workspace
-- id, so it already says which workspace it belongs to.

-- The one workspace this instance already had, named for it.
INSERT OR IGNORE INTO workspaces (id, name) VALUES ('workspace', 'Kanban Toolkit');

-- a person in a workspace
ALTER TABLE people ADD COLUMN workspace_id TEXT REFERENCES workspaces (id);
UPDATE people SET workspace_id = 'workspace' WHERE workspace_id IS NULL;
CREATE TRIGGER IF NOT EXISTS people_needs_workspace_insert BEFORE INSERT ON people
WHEN NEW.workspace_id IS NULL
BEGIN SELECT RAISE(ABORT, 'a person in a workspace belongs to a workspace'); END;
CREATE TRIGGER IF NOT EXISTS people_needs_workspace_update BEFORE UPDATE OF workspace_id ON people
WHEN NEW.workspace_id IS NULL
BEGIN SELECT RAISE(ABORT, 'a person in a workspace belongs to a workspace'); END;

-- an issue type
ALTER TABLE issue_types ADD COLUMN workspace_id TEXT REFERENCES workspaces (id);
UPDATE issue_types SET workspace_id = 'workspace' WHERE workspace_id IS NULL;
CREATE TRIGGER IF NOT EXISTS issue_types_needs_workspace_insert BEFORE INSERT ON issue_types
WHEN NEW.workspace_id IS NULL
BEGIN SELECT RAISE(ABORT, 'an issue type belongs to a workspace'); END;
CREATE TRIGGER IF NOT EXISTS issue_types_needs_workspace_update BEFORE UPDATE OF workspace_id ON issue_types
WHEN NEW.workspace_id IS NULL
BEGIN SELECT RAISE(ABORT, 'an issue type belongs to a workspace'); END;

-- a board
ALTER TABLE boards ADD COLUMN workspace_id TEXT REFERENCES workspaces (id);
UPDATE boards SET workspace_id = 'workspace' WHERE workspace_id IS NULL;
CREATE TRIGGER IF NOT EXISTS boards_needs_workspace_insert BEFORE INSERT ON boards
WHEN NEW.workspace_id IS NULL
BEGIN SELECT RAISE(ABORT, 'a board belongs to a workspace'); END;
CREATE TRIGGER IF NOT EXISTS boards_needs_workspace_update BEFORE UPDATE OF workspace_id ON boards
WHEN NEW.workspace_id IS NULL
BEGIN SELECT RAISE(ABORT, 'a board belongs to a workspace'); END;

-- a lane
ALTER TABLE lanes ADD COLUMN workspace_id TEXT REFERENCES workspaces (id);
UPDATE lanes SET workspace_id = 'workspace' WHERE workspace_id IS NULL;
CREATE TRIGGER IF NOT EXISTS lanes_needs_workspace_insert BEFORE INSERT ON lanes
WHEN NEW.workspace_id IS NULL
BEGIN SELECT RAISE(ABORT, 'a lane belongs to a workspace'); END;
CREATE TRIGGER IF NOT EXISTS lanes_needs_workspace_update BEFORE UPDATE OF workspace_id ON lanes
WHEN NEW.workspace_id IS NULL
BEGIN SELECT RAISE(ABORT, 'a lane belongs to a workspace'); END;

-- an item
ALTER TABLE items ADD COLUMN workspace_id TEXT REFERENCES workspaces (id);
UPDATE items SET workspace_id = 'workspace' WHERE workspace_id IS NULL;
CREATE TRIGGER IF NOT EXISTS items_needs_workspace_insert BEFORE INSERT ON items
WHEN NEW.workspace_id IS NULL
BEGIN SELECT RAISE(ABORT, 'an item belongs to a workspace'); END;
CREATE TRIGGER IF NOT EXISTS items_needs_workspace_update BEFORE UPDATE OF workspace_id ON items
WHEN NEW.workspace_id IS NULL
BEGIN SELECT RAISE(ABORT, 'an item belongs to a workspace'); END;

-- a log entry
ALTER TABLE item_log ADD COLUMN workspace_id TEXT REFERENCES workspaces (id);
UPDATE item_log SET workspace_id = 'workspace' WHERE workspace_id IS NULL;
CREATE TRIGGER IF NOT EXISTS item_log_needs_workspace_insert BEFORE INSERT ON item_log
WHEN NEW.workspace_id IS NULL
BEGIN SELECT RAISE(ABORT, 'a log entry belongs to a workspace'); END;
CREATE TRIGGER IF NOT EXISTS item_log_needs_workspace_update BEFORE UPDATE OF workspace_id ON item_log
WHEN NEW.workspace_id IS NULL
BEGIN SELECT RAISE(ABORT, 'a log entry belongs to a workspace'); END;

-- a placement
ALTER TABLE placements ADD COLUMN workspace_id TEXT REFERENCES workspaces (id);
UPDATE placements SET workspace_id = 'workspace' WHERE workspace_id IS NULL;
CREATE TRIGGER IF NOT EXISTS placements_needs_workspace_insert BEFORE INSERT ON placements
WHEN NEW.workspace_id IS NULL
BEGIN SELECT RAISE(ABORT, 'a placement belongs to a workspace'); END;
CREATE TRIGGER IF NOT EXISTS placements_needs_workspace_update BEFORE UPDATE OF workspace_id ON placements
WHEN NEW.workspace_id IS NULL
BEGIN SELECT RAISE(ABORT, 'a placement belongs to a workspace'); END;

-- an edge
ALTER TABLE edges ADD COLUMN workspace_id TEXT REFERENCES workspaces (id);
UPDATE edges SET workspace_id = 'workspace' WHERE workspace_id IS NULL;
CREATE TRIGGER IF NOT EXISTS edges_needs_workspace_insert BEFORE INSERT ON edges
WHEN NEW.workspace_id IS NULL
BEGIN SELECT RAISE(ABORT, 'an edge belongs to a workspace'); END;
CREATE TRIGGER IF NOT EXISTS edges_needs_workspace_update BEFORE UPDATE OF workspace_id ON edges
WHEN NEW.workspace_id IS NULL
BEGIN SELECT RAISE(ABORT, 'an edge belongs to a workspace'); END;

-- a link
ALTER TABLE links ADD COLUMN workspace_id TEXT REFERENCES workspaces (id);
UPDATE links SET workspace_id = 'workspace' WHERE workspace_id IS NULL;
CREATE TRIGGER IF NOT EXISTS links_needs_workspace_insert BEFORE INSERT ON links
WHEN NEW.workspace_id IS NULL
BEGIN SELECT RAISE(ABORT, 'a link belongs to a workspace'); END;
CREATE TRIGGER IF NOT EXISTS links_needs_workspace_update BEFORE UPDATE OF workspace_id ON links
WHEN NEW.workspace_id IS NULL
BEGIN SELECT RAISE(ABORT, 'a link belongs to a workspace'); END;

-- an objective
ALTER TABLE objectives ADD COLUMN workspace_id TEXT REFERENCES workspaces (id);
UPDATE objectives SET workspace_id = 'workspace' WHERE workspace_id IS NULL;
CREATE TRIGGER IF NOT EXISTS objectives_needs_workspace_insert BEFORE INSERT ON objectives
WHEN NEW.workspace_id IS NULL
BEGIN SELECT RAISE(ABORT, 'an objective belongs to a workspace'); END;
CREATE TRIGGER IF NOT EXISTS objectives_needs_workspace_update BEFORE UPDATE OF workspace_id ON objectives
WHEN NEW.workspace_id IS NULL
BEGIN SELECT RAISE(ABORT, 'an objective belongs to a workspace'); END;

-- a key result
ALTER TABLE key_results ADD COLUMN workspace_id TEXT REFERENCES workspaces (id);
UPDATE key_results SET workspace_id = 'workspace' WHERE workspace_id IS NULL;
CREATE TRIGGER IF NOT EXISTS key_results_needs_workspace_insert BEFORE INSERT ON key_results
WHEN NEW.workspace_id IS NULL
BEGIN SELECT RAISE(ABORT, 'a key result belongs to a workspace'); END;
CREATE TRIGGER IF NOT EXISTS key_results_needs_workspace_update BEFORE UPDATE OF workspace_id ON key_results
WHEN NEW.workspace_id IS NULL
BEGIN SELECT RAISE(ABORT, 'a key result belongs to a workspace'); END;

-- a board template
ALTER TABLE board_templates ADD COLUMN workspace_id TEXT REFERENCES workspaces (id);
UPDATE board_templates SET workspace_id = 'workspace' WHERE workspace_id IS NULL;
CREATE TRIGGER IF NOT EXISTS board_templates_needs_workspace_insert BEFORE INSERT ON board_templates
WHEN NEW.workspace_id IS NULL
BEGIN SELECT RAISE(ABORT, 'a board template belongs to a workspace'); END;
CREATE TRIGGER IF NOT EXISTS board_templates_needs_workspace_update BEFORE UPDATE OF workspace_id ON board_templates
WHEN NEW.workspace_id IS NULL
BEGIN SELECT RAISE(ABORT, 'a board template belongs to a workspace'); END;

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (18, 'workspaces');
