-- Objectives commit to a period with a window, and stop carrying a score.
--
-- A period used to be a label on an objective ("FY26 Q4"): two objectives in the same quarter could
-- say different things, and nothing in the workspace knew when that quarter started or ended. It is
-- a record now — a name and the window it covers — and an objective names one. An objective has no
-- target date of its own: it is due when its period ends.
--
-- The score goes. Completeness is the work below the initiatives that serve an objective, read from
-- the board itself; a number typed at the end of a period was a second answer to the same question,
-- and the two were free to disagree. The column goes with the field, for the same reason
-- `items.size` did: a number nobody reads is a number that will be read again by mistake.
--
-- The periods a workspace already has are made from the labels its objectives carry, with no
-- window. Nobody has told us when those quarters ran, and a date invented here would be a
-- commitment on the wrong day; their windows are set in the Objectives view.

CREATE TABLE IF NOT EXISTS periods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start TEXT,
  end TEXT,
  workspace_id TEXT REFERENCES workspaces (id)
);
CREATE INDEX IF NOT EXISTS periods_workspace ON periods (workspace_id);

-- One period per label a workspace already used. The id is minted here because a label is not an
-- identity: two workspaces may both have a "FY26 Q4", and they must not share one.
INSERT INTO periods (id, name, workspace_id)
  SELECT 'p-' || lower(hex(randomblob(8))), period, workspace_id
  FROM objectives
  GROUP BY workspace_id, period;

ALTER TABLE objectives ADD COLUMN period_id TEXT REFERENCES periods (id);
UPDATE objectives SET period_id = (
  SELECT periods.id FROM periods
  WHERE periods.workspace_id = objectives.workspace_id AND periods.name = objectives.period
) WHERE period_id IS NULL;
CREATE INDEX IF NOT EXISTS objectives_period ON objectives (period_id);

ALTER TABLE objectives DROP COLUMN period;
ALTER TABLE objectives DROP COLUMN score;

-- `scored` was the old name for the review state; the score itself is gone, and the state it named
-- is still worth keeping.
UPDATE objectives SET status = 'reviewed' WHERE status = 'scored';

CREATE TRIGGER IF NOT EXISTS periods_needs_workspace_insert BEFORE INSERT ON periods
WHEN NEW.workspace_id IS NULL
BEGIN SELECT RAISE(ABORT, 'a period belongs to a workspace'); END;
CREATE TRIGGER IF NOT EXISTS periods_needs_workspace_update BEFORE UPDATE OF workspace_id ON periods
WHEN NEW.workspace_id IS NULL
BEGIN SELECT RAISE(ABORT, 'a period belongs to a workspace'); END;

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (36, 'objective_periods');
