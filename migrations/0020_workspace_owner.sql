-- The workspace is the tenant, and it has an owner.
--
-- Task 126 as first built put the account's record on the *deployment*: a name, a billing email,
-- a plan, and an "Account Admin" who could close everything. That is the wrong shape. An account is
-- a person; a workspace holds many of them; the **owner** is the account that pays for it. So the
-- record moves to the workspace, and the deployment stops having one.
--
-- Three consequences, all in this file:
--
-- 1. `workspaces.owner_id` — the account that is charged. A field, not a role: a workspace may have
--    several administrators, and exactly one payer.
-- 2. The billing record moves from `instance_settings` to `workspaces`, because it is the workspace
--    that is billed.
-- 3. `instance_settings.name` goes: the deployment is not a thing anybody names in the product, and
--    the workspace's own name has lived in `workspace` (settings) all along.

ALTER TABLE workspaces ADD COLUMN owner_id TEXT REFERENCES users (id) ON DELETE SET NULL;

-- Who owns the workspace that already exists: its first active administrator, and nobody if it has
-- none — an ownerless workspace is a state the interface has to be able to show rather than a
-- migration that has to invent somebody.
UPDATE workspaces SET owner_id = (
  SELECT w.user_id FROM workspace_members w
    JOIN users u ON u.id = w.user_id
   WHERE w.workspace_id = workspaces.id AND w.role = 'admin' AND u.status = 'active'
   ORDER BY w.created_at, w.user_id
   LIMIT 1
)
WHERE owner_id IS NULL;

-- The billed record, on the thing that is billed.
ALTER TABLE workspaces ADD COLUMN billing_email TEXT;
ALTER TABLE workspaces ADD COLUMN company_name TEXT;
ALTER TABLE workspaces ADD COLUMN billing_reference TEXT;
ALTER TABLE workspaces ADD COLUMN plan TEXT;

-- Carry what was entered on the deployment into the one workspace it had, then take it away there.
UPDATE workspaces SET
  billing_email = (SELECT billing_email FROM instance_settings WHERE id = 'instance'),
  company_name = (SELECT company_name FROM instance_settings WHERE id = 'instance'),
  billing_reference = (SELECT billing_reference FROM instance_settings WHERE id = 'instance'),
  plan = (SELECT plan FROM instance_settings WHERE id = 'instance')
WHERE id = 'workspace';

ALTER TABLE instance_settings DROP COLUMN name;
ALTER TABLE instance_settings DROP COLUMN billing_email;
ALTER TABLE instance_settings DROP COLUMN company_name;
ALTER TABLE instance_settings DROP COLUMN billing_reference;
ALTER TABLE instance_settings DROP COLUMN plan;

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (20, 'workspace_owner');
