-- The account: its name, what billing needs to be arranged, and nothing more.
--
-- The Account Admin is the instance administrator (task 126): no new role, no new table for who may
-- sign in. What is new is the account's own record — the name people see, and the four fields a
-- billing arrangement needs.
--
-- Deliberately no card number, no CVC, no bank detail. A database that stores them is a liability
-- with no upside: the payment provider holds them, and this row holds the provider's customer
-- reference instead. A test asserts this table's shape, so a later "just one more field" has to say
-- what it is doing here.

ALTER TABLE instance_settings ADD COLUMN name TEXT NOT NULL DEFAULT 'Kanban Toolkit';
ALTER TABLE instance_settings ADD COLUMN billing_email TEXT;
ALTER TABLE instance_settings ADD COLUMN company_name TEXT;
ALTER TABLE instance_settings ADD COLUMN billing_reference TEXT;
ALTER TABLE instance_settings ADD COLUMN plan TEXT;

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (19, 'account');
