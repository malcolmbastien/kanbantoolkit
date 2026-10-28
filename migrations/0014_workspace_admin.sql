-- A workspace with a name of its own, and invitations that say where they lead.
--
-- The workspace row has been a settings row until now; the members screen needs something to call
-- it, so it gains a name and a description. `scope` on an invitation is the difference between
-- "come into this instance" and "come into this workspace": they are different promises even when
-- there is one workspace to come into.

ALTER TABLE workspace ADD COLUMN name TEXT NOT NULL DEFAULT 'Kanban Toolkit';
ALTER TABLE workspace ADD COLUMN description TEXT NOT NULL DEFAULT '';

ALTER TABLE invites ADD COLUMN scope TEXT NOT NULL DEFAULT 'instance' CHECK (scope IN ('instance', 'workspace'));

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (14, 'workspace_admin');
