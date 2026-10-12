CREATE TABLE "ObjectivePreference" (
  "orgId" UUID NOT NULL,
  "objectiveId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY ("objectiveId", "userId"),
  FOREIGN KEY ("orgId", "objectiveId") REFERENCES "Objective"("orgId", "id") ON DELETE CASCADE,
  FOREIGN KEY ("orgId", "userId") REFERENCES "Membership"("orgId", "userId") ON DELETE CASCADE
);
CREATE INDEX "ObjectivePreference_orgId_userId_idx" ON "ObjectivePreference"("orgId", "userId");
CREATE INDEX "Notification_orgId_userId_readAt_idx" ON "Notification"("orgId", "userId", "readAt");
ALTER TABLE "CheckIn" ADD CONSTRAINT "checkin_note" CHECK (length(btrim(note)) > 0);
ALTER TABLE "Comment" ADD CONSTRAINT "comment_text" CHECK (length(btrim(text)) > 0);
-- Entries can only be corrected by adding a new entry. No application update/delete routes exist.
CREATE FUNCTION reject_collaboration_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Collaboration entries are immutable'; END;
$$;
CREATE TRIGGER checkin_immutable BEFORE UPDATE ON "CheckIn" FOR EACH ROW EXECUTE FUNCTION reject_collaboration_update();
CREATE TRIGGER comment_immutable BEFORE UPDATE ON "Comment" FOR EACH ROW EXECUTE FUNCTION reject_collaboration_update();
