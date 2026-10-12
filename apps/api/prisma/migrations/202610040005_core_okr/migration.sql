ALTER TABLE "Period" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0);
ALTER TABLE "Objective" ADD COLUMN "closingNote" TEXT NOT NULL DEFAULT '';
CREATE INDEX "Objective_orgId_periodId_idx" ON "Objective"("orgId", "periodId");
CREATE INDEX "Assignment_orgId_membershipId_idx" ON "Assignment"("orgId", "membershipId");
CREATE INDEX "KeyResult_orgId_ownerId_idx" ON "KeyResult"("orgId", "ownerId");
