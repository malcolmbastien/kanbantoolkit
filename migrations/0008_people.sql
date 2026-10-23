-- Two questions, two tables.
--
-- "May this person sign in at all" is instance access; "what may they do here" is workspace
-- authority. They are written as one column today and they are not the same question: an instance
-- administrator can repair a workspace they are not on, and a person can be on the roster without
-- being on any board.
--
-- `members` is left exactly as it was — this file adds the axes beside it and copies what exists, so
-- no instance is left without an administrator. The old table is retired in a later migration.

ALTER TABLE users ADD COLUMN avatar_url TEXT;
ALTER TABLE users ADD COLUMN timezone TEXT;
ALTER TABLE users ADD COLUMN language TEXT;
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive'));
ALTER TABLE users ADD COLUMN last_seen_at TEXT;
ALTER TABLE users ADD COLUMN updated_at TEXT;

-- The door.
CREATE TABLE IF NOT EXISTS instance_members (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- The authority. `workspace_id` names the workspace settings row until task 122.1 gives a workspace
-- an identity of its own; the key is (workspace, person), so a role is one answer and not a set.
CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('viewer', 'editor', 'admin')),
  invited_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (workspace_id, user_id)
);

-- Every person who could already sign in keeps the ability they had: an owner becomes an
-- administrator on both axes, a member remains a member of the instance and an editor here.
INSERT OR IGNORE INTO instance_members (user_id, role)
  SELECT user_id, CASE WHEN role = 'owner' THEN 'admin' ELSE 'member' END FROM members;

INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role)
  SELECT 'workspace', user_id, CASE WHEN role = 'owner' THEN 'admin' ELSE 'editor' END FROM members;

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (8, 'people');
