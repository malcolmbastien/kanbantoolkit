-- The board design gets a revision.
--
-- A workspace was written once, whole, by the one-shot import at first sign-in; from then on only
-- *items* moved, one at a time, each with the revision it was based on. The boards, the lanes and
-- where every card sits had no server-side write at all — which is fine while the only way to make a
-- workspace is to upload one, and wrong the moment a person can create a board on an empty instance.
--
-- So the design gets a document and a revision, the way an item has one:
--
--   * `PUT /api/workspace/structure` sends boards, lanes and placements together — they are one
--     tree, and a half-written tree is a board nobody can read;
--   * the sender says which revision it was working from, and a design that has moved past it is
--     refused rather than silently overwritten. Whole-document replacement plus a revision is the
--     smallest thing that can be honest about two administrators designing at once.
--
-- Existing workspaces start at revision 1: they already have a design, and a client that adopts it
-- must be told which revision that design *is*.
--
-- Placements reference items, which are written separately; the route skips a placement whose item
-- the server has not met yet, and the client sends again once its queue has drained. A placement is
-- a position, not a record of its own, so a skipped one is late rather than lost.

CREATE TABLE IF NOT EXISTS workspace_structure (
  workspace_id TEXT PRIMARY KEY,
  rev INTEGER NOT NULL DEFAULT 1
);

INSERT OR IGNORE INTO workspace_structure (workspace_id, rev)
  SELECT workspace_id, 1 FROM boards GROUP BY workspace_id;

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (28, 'structure_rev');
