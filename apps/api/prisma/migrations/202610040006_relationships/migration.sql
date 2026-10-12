ALTER TABLE "Objective" ADD COLUMN "dependencyOverrideNote" TEXT NOT NULL DEFAULT '';
CREATE INDEX "ObjectiveLink_orgId_targetId_type_idx" ON "ObjectiveLink"("orgId", "targetId", "type");
