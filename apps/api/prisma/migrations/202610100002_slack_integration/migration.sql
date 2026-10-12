CREATE UNIQUE INDEX "AuditEvent_orgId_id_key" ON "AuditEvent"("orgId", "id");

CREATE TABLE "SlackIntegration" (
  "orgId" UUID PRIMARY KEY REFERENCES "Organization"("id") ON DELETE CASCADE,
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "webhookCiphertext" TEXT,
  "channelLabel" TEXT NOT NULL DEFAULT '',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "objectiveUpdates" BOOLEAN NOT NULL DEFAULT true,
  "notifications" BOOLEAN NOT NULL DEFAULT true,
  "nextSendAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSentAt" TIMESTAMP(3),
  "lastError" TEXT,
  CHECK (NOT "enabled" OR ("webhookCiphertext" IS NOT NULL AND length("channelLabel") > 0))
);

CREATE TABLE "SlackDelivery" (
  "id" UUID PRIMARY KEY,
  "orgId" UUID NOT NULL REFERENCES "SlackIntegration"("orgId") ON DELETE CASCADE,
  "integrationVersion" INTEGER NOT NULL CHECK ("integrationVersion" > 0),
  "objectiveId" UUID,
  "auditId" UUID,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('objective', 'notification', 'test')),
  "payload" JSONB NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" BETWEEN 0 AND 5),
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("orgId", "objectiveId") REFERENCES "Objective"("orgId", "id") ON DELETE CASCADE,
  FOREIGN KEY ("orgId", "auditId") REFERENCES "AuditEvent"("orgId", "id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "SlackDelivery_orgId_auditId_key" ON "SlackDelivery"("orgId", "auditId");
CREATE INDEX "SlackDelivery_sentAt_nextAttemptAt_idx" ON "SlackDelivery"("sentAt", "nextAttemptAt");
