-- One row per reported error, and no workspace in it. The endpoint is the only writer; until the
-- app has accounts, the dashboard's SQL console is the place to read it.
CREATE TABLE IF NOT EXISTS errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  message TEXT NOT NULL,
  stack TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  view TEXT NOT NULL DEFAULT '',
  release TEXT NOT NULL DEFAULT '',
  ua TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS errors_at ON errors (at);
CREATE INDEX IF NOT EXISTS errors_limit ON errors (ip_hash, at);
