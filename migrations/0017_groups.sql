-- Groups: a role granted once to many.
--
-- Deliberately three flat tables and no parent column. A group cannot contain a group, because
-- there is nothing to point at: nesting arrives only when somebody needs it, and then it arrives
-- with a cycle guard. Until then the absence is the guard (task 146, R5).
--
-- `group_workspace_roles` sits beside `workspace_members` rather than replacing it: the direct row
-- stays the single assignment point for one person, and the permission check reads the union of the
-- two with the highest role winning. Nothing in the board code learns that groups exist.

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  /** An inactive group grants nothing, immediately. It is not deleted, so it can be turned back on. */
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One group per name, case-insensitively: two "Platform Leads" is a list somebody has to guess at.
CREATE UNIQUE INDEX IF NOT EXISTS groups_name ON groups (lower(name));

CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  added_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS group_members_user ON group_members (user_id);

CREATE TABLE IF NOT EXISTS group_workspace_roles (
  group_id TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'admin')),
  PRIMARY KEY (group_id, workspace_id)
);

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (17, 'groups');
