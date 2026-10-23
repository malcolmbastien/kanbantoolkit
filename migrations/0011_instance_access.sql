-- Whether this instance lets anybody in, or only the people it invited.
--
-- Closed by default: a new instance must not be a public sign-up form that happened to be deployed.
-- The first person to arrive is the exception — there has to be somebody who can open the door, and
-- an instance with no administrator is one nobody can administer.
--
-- One row, named `instance`, because the posture is about the deployment rather than about any one
-- workspace. Changing it is an administrator's act and leaves an audit event.

CREATE TABLE IF NOT EXISTS instance_settings (
  id TEXT PRIMARY KEY,
  access TEXT NOT NULL DEFAULT 'closed' CHECK (access IN ('closed', 'open')),
  updated_at TEXT
);

INSERT OR IGNORE INTO instance_settings (id, access) VALUES ('instance', 'closed');

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (11, 'instance_access');
