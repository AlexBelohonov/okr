-- Existing relationships must be resolved explicitly before migration. Never
-- choose a surviving parent or silently discard an existing relationship.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ObjectiveLink" WHERE "type" = 'alignment'
    GROUP BY "orgId", "targetId" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'An objective has multiple alignment parents. Select the parent to keep and detach the others before applying this migration.';
  END IF;
END $$;

-- Prerequisites remain a separate DAG with unrestricted incoming links.
CREATE UNIQUE INDEX "ObjectiveLink_single_alignment_parent"
  ON "ObjectiveLink" ("orgId", "targetId") WHERE "type" = 'alignment';
