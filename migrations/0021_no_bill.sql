-- The bill leaves the product.
--
-- Task 126 put the account's record on the deployment, then task 126 (revised) moved it to the
-- workspace beside an **owner** — the account that would be charged. Task 163 settled that a
-- deployment is one team and nobody signs up for anything; task 166 is the other half: nothing is
-- sold, so there is nothing to invoice, no plan to be on, and no payer to name.
--
-- What this drops, and why each one has no meaning now:
--
--   owner_id           the account that would be charged. There is no charge; the workspace's
--                      administrator is the concept, and `workspace_members` already records it.
--   billing_email      where an invoice would go. There is no invoice.
--   company_name       the name on that invoice.
--   billing_reference  a pointer to a payment provider's customer record. There is no provider.
--   plan               which tier the workspace is on. There is one shape of the product.
--
-- A card number was never stored — the record pointed at the provider, and the digits stayed with
-- them — so this is the last of the commercial shape rather than a clean-up of anything sensitive.
-- The workspace itself, its name, its members and all its work stay exactly where they are.

ALTER TABLE workspaces DROP COLUMN owner_id;
ALTER TABLE workspaces DROP COLUMN billing_email;
ALTER TABLE workspaces DROP COLUMN company_name;
ALTER TABLE workspaces DROP COLUMN billing_reference;
ALTER TABLE workspaces DROP COLUMN plan;

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (21, 'no_bill');
