-- The workspace: every entity the browser persists, and nothing else.
--
-- One row per thing that has an identity. What is an array of references rather than an entity —
-- an item's tags, its people, a board's linked boards — is stored as JSON in its row, because a
-- reference is not a thing the workspace owns; the thing it points at has its own table.
--
-- Plain SQLite, so the same file applies to D1 and to a self-hosted instance. There is one
-- workspace per instance until task 122 introduces members and the boundary they imply.

-- A person in the workspace — an assignee. Not an account: `users` is the account table, and
-- somebody can be on a card without ever signing in, or sign in without being on one.
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar_url TEXT
);

CREATE TABLE IF NOT EXISTS issue_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  band TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  archived INTEGER,
  archived_at INTEGER,
  linked_board_ids TEXT,
  default_card_type_id TEXT,
  default_drop_lane_id TEXT,
  wip_enforcement TEXT,
  position INTEGER NOT NULL DEFAULT 0
);

-- A board's own vocabulary: the kinds its initiatives can be, and the tags its work can carry.
CREATE TABLE IF NOT EXISTS board_initiative_types (
  board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (board_id, id)
);

CREATE TABLE IF NOT EXISTS board_tags (
  board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (board_id, id)
);

-- Two trees per board, told apart by `workflow`. A subtree never mixes them.
CREATE TABLE IF NOT EXISTS lanes (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES lanes (id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  workflow TEXT NOT NULL,
  orientation TEXT,
  stage TEXT,
  wip_limit INTEGER,
  description TEXT
);
CREATE INDEX IF NOT EXISTS lanes_board ON lanes (board_id, workflow);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  type_id TEXT NOT NULL,
  size INTEGER,
  initiative_type_id TEXT,
  tag_ids TEXT,
  assignees TEXT,
  priority TEXT,
  target_start_date TEXT,
  target_end_date TEXT,
  created_at INTEGER NOT NULL,
  rev INTEGER,
  resolved_at INTEGER,
  last_move_reason TEXT,
  blocked INTEGER,
  blocked_reason TEXT,
  archived INTEGER,
  archived_at INTEGER
);

CREATE TABLE IF NOT EXISTS item_checklist (
  item_id TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, id)
);

-- An item's history: append-only, and the reason a card is never asked what happened to it twice.
CREATE TABLE IF NOT EXISTS item_log (
  item_id TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  by_user TEXT,
  note TEXT,
  from_lane_id TEXT,
  to_lane_id TEXT,
  from_stage TEXT,
  to_stage TEXT,
  board_id TEXT,
  PRIMARY KEY (item_id, id)
);
CREATE INDEX IF NOT EXISTS item_log_at ON item_log (item_id, at);

-- The explicit board and cell a card sits in: one per board.
CREATE TABLE IF NOT EXISTS placements (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  lane_id TEXT NOT NULL REFERENCES lanes (id) ON DELETE CASCADE,
  lane_entered_at INTEGER,
  rank INTEGER
);
CREATE INDEX IF NOT EXISTS placements_board ON placements (board_id);
CREATE INDEX IF NOT EXISTS placements_item ON placements (item_id);

-- Two kinds of edge: decomposition (parent to child) and attribution (objective to item).
CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL
);

-- Dependencies, and only dependencies.
CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  reason TEXT
);

CREATE TABLE IF NOT EXISTS objectives (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  period TEXT NOT NULL,
  status TEXT NOT NULL,
  score REAL
);

CREATE TABLE IF NOT EXISTS key_results (
  id TEXT PRIMARY KEY,
  objective_id TEXT NOT NULL REFERENCES objectives (id) ON DELETE CASCADE,
  title TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS board_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  band TEXT NOT NULL,
  default_card_type_id TEXT,
  wip_enforcement TEXT
);

-- A template's lanes are a design, not a board: `key` wires parent to child inside the template.
CREATE TABLE IF NOT EXISTS template_lanes (
  template_id TEXT NOT NULL REFERENCES board_templates (id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  parent_key TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  orientation TEXT,
  stage TEXT,
  wip_limit INTEGER,
  description TEXT,
  PRIMARY KEY (template_id, key)
);

-- Settings rather than entities: values the workspace remembers, not things it owns. One row,
-- named `workspace`, until task 122 gives the workspace an identity of its own.
CREATE TABLE IF NOT EXISTS workspace (
  id TEXT PRIMARY KEY,
  board_id TEXT,
  auto_archive_days INTEGER,
  saved_filters TEXT,
  collapsed_lanes TEXT
);
