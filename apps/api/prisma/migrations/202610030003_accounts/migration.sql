CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "AuthToken_userId_type_usedAt_idx" ON "AuthToken"("userId", "type", "usedAt");
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_type_check" CHECK (type IN ('verify', 'reset'));
ALTER TABLE "User" ADD CONSTRAINT "User_email_normalized_check" CHECK (email = lower(btrim(email)));
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_email_normalized_check" CHECK (email = lower(btrim(email)));
