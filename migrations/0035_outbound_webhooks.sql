-- Outbound events, the endpoints that want them, and the deliveries between them.
--
-- An event is written before it is delivered, so a receiver that was down is a retry rather than a
-- lost fact. The payload is the envelope the receiver gets, stored once and shared by every
-- endpoint that subscribed to it; a delivery is the per-endpoint attempt, its status and its next
-- try. Secrets live on the endpoint and are never in the event or the delivery, so a delivery log
-- can be read without handing anybody the key that signs it.
--
-- This is deliberately not a workspace import table: webhooks are configuration for the instance,
-- and importing a workspace must not silently change who is listening to it.

CREATE TABLE IF NOT EXISTS outbound_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  actor_id TEXT
);

CREATE INDEX IF NOT EXISTS outbound_events_workspace ON outbound_events (workspace_id, occurred_at);

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  event_types TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  disabled_reason TEXT
);

CREATE INDEX IF NOT EXISTS webhook_endpoints_workspace ON webhook_endpoints (workspace_id, active);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL REFERENCES webhook_endpoints (id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES outbound_events (id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  response_status INTEGER,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS webhook_deliveries_due ON webhook_deliveries (status, next_attempt_at);

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (35, 'outbound_webhooks');
