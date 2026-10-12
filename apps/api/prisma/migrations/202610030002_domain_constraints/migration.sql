-- Prisma does not represent CHECK constraints; keep domain invariants in SQL as well.
ALTER TABLE "Membership" ADD CONSTRAINT "membership_role" CHECK ("role" IN ('owner', 'admin', 'manager', 'member', 'viewer'));
ALTER TABLE "Invitation" ADD CONSTRAINT "invitation_role" CHECK ("role" IN ('owner', 'admin', 'manager', 'member', 'viewer'));
ALTER TABLE "AuthToken" ADD CONSTRAINT "auth_token_type" CHECK ("type" IN ('verify', 'reset'));
ALTER TABLE "Assignment" ADD CONSTRAINT "assignment_role" CHECK ("role" IN ('coowner', 'contributor', 'follower'));

ALTER TABLE "Period" ADD CONSTRAINT "period_dates" CHECK (
  "startDate" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND "endDate" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  AND "startDate"::date <= "endDate"::date
);
ALTER TABLE "Objective" ADD CONSTRAINT "objective_dates" CHECK (
  "startDate" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND "endDate" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  AND "startDate"::date <= "endDate"::date
);
ALTER TABLE "Objective" ADD CONSTRAINT "objective_scope" CHECK ("scope" IN ('company', 'team', 'personal'));
ALTER TABLE "Objective" ADD CONSTRAINT "objective_team_scope" CHECK (("scope" = 'team') = ("teamId" IS NOT NULL));
ALTER TABLE "Objective" ADD CONSTRAINT "objective_progress_mode" CHECK ("progressMode" IN ('key_results', 'children'));
ALTER TABLE "Objective" ADD CONSTRAINT "objective_state" CHECK ("state" IN ('draft', 'active', 'completed', 'cancelled'));
ALTER TABLE "Objective" ADD CONSTRAINT "objective_health" CHECK ("health" IN ('on_track', 'at_risk', 'off_track'));
ALTER TABLE "Objective" ADD CONSTRAINT "objective_version" CHECK ("version" > 0);
ALTER TABLE "Objective" ADD CONSTRAINT "objective_final_score" CHECK ("finalScore" IS NULL OR ("finalScore" >= 0 AND "finalScore" <= 100));

ALTER TABLE "KeyResult" ADD CONSTRAINT "key_result_type" CHECK ("type" IN ('number', 'binary'));
ALTER TABLE "KeyResult" ADD CONSTRAINT "key_result_target" CHECK ("type" = 'binary' OR "baseline" <> "target");
ALTER TABLE "KeyResult" ADD CONSTRAINT "key_result_binary" CHECK ("type" <> 'binary' OR ("baseline" = 0 AND "target" = 1 AND "current" IN (0, 1)));
ALTER TABLE "KeyResult" ADD CONSTRAINT "key_result_weight" CHECK ("weight" > 0 AND "weight" <= 100000);
ALTER TABLE "KeyResult" ADD CONSTRAINT "key_result_finite" CHECK (
  "baseline" > '-Infinity'::float8 AND "baseline" < 'Infinity'::float8 AND
  "target" > '-Infinity'::float8 AND "target" < 'Infinity'::float8 AND
  "current" > '-Infinity'::float8 AND "current" < 'Infinity'::float8
);
ALTER TABLE "KeyResult" ADD CONSTRAINT "key_result_version" CHECK ("version" > 0);

ALTER TABLE "ObjectiveLink" ADD CONSTRAINT "link_type" CHECK ("type" IN ('alignment', 'dependency'));
ALTER TABLE "ObjectiveLink" ADD CONSTRAINT "link_endpoints" CHECK ("sourceId" <> "targetId");
ALTER TABLE "ObjectiveLink" ADD CONSTRAINT "link_weight" CHECK ("weight" > 0 AND "weight" <= 100000);
ALTER TABLE "CheckIn" ADD CONSTRAINT "checkin_health" CHECK ("health" IN ('on_track', 'at_risk', 'off_track'));
ALTER TABLE "CheckIn" ADD CONSTRAINT "checkin_progress" CHECK ("progress" >= 0 AND "progress" <= 100);
ALTER TABLE "AuditEvent" ADD CONSTRAINT "audit_objective_org" CHECK ("objectiveId" IS NULL OR "orgId" IS NOT NULL);
ALTER TABLE "EmailOutbox" ADD CONSTRAINT "outbox_attempts" CHECK ("attempts" >= 0);
