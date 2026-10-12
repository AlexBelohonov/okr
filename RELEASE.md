# R010 Release Review

This report retains the historical R010 integrated verification. R012 subsequently adds outbound Slack and a ninth migration; its current behavior, affected regression results and live-Slack setup limit are recorded in [PROGRESS](PROGRESS.md) and [REVIEWS](REVIEWS.md).

Date: 2026-10-10. CH10 integrates the delivered accounts, organizations, objectives, graphs, collaboration, platform administration and operations. All numbered product requirements have executable coverage in [REQUIREMENT_TEST_MATRIX](REQUIREMENT_TEST_MATRIX.md). The local review application is at **http://localhost:8080**. This revision is a review checkpoint, not a Git tag or an external production deployment.

## Verification Results

| Check | Result | Retained evidence |
| --- | --- | --- |
| Docker API/web/tools/browser builds | Passed; Prisma generation and shared/API/web TypeScript builds | [Build log](artifacts/ch10-build.log) |
| Unit/API checks | 24 passed, zero skips/failures | [Backend log](artifacts/ch10-backend.log) |
| PostgreSQL integration | 99 passed, zero skips/failures, fresh isolated database | [Backend log](artifacts/ch10-backend.log) |
| Full self-hosted desktop/mobile browser suite | 90 passed; four expected SMTP/disabled-signup skips | [Verified log](artifacts/ch10-selfhosted-verified.log), [HTML report](artifacts/ch10-selfhosted-verified/playwright-report/index.html) |
| Full SMTP desktop/mobile browser suite | 92 passed; two expected disabled-signup skips; actual Mailpit verification/reset delivery and invitation onboarding | [Verified log](artifacts/ch10-smtp-verified.log), [HTML report](artifacts/ch10-smtp-verified/playwright-report/index.html) |
| Default-disabled signup, self-hosted | 4 passed: UI/API disabled, existing login and invited account creation | [Log](artifacts/ch10-disabled-selfhosted.log), [HTML report](artifacts/ch10-disabled-selfhosted/playwright-report/index.html) |
| Default-disabled signup, SMTP | Same four checks passed | [Log](artifacts/ch10-disabled-smtp.log), [HTML report](artifacts/ch10-disabled-smtp/playwright-report/index.html) |
| Empty-volume startup / migration rerun | Eight migrations applied successfully; rerun has no pending migrations | [Clean startup](artifacts/ch10-clean-migrations.log), [Rerun](artifacts/ch10-migration-rerun.log) |
| Database unavailable / restart persistence | Liveness 200/readiness 503 while stopped; record survived restart and was removed; readiness recovered | [Availability](artifacts/ch10-db-unavailable.log), [Persistence](artifacts/ch10-persistence-verify.log), [Restart](artifacts/ch10-restart.log) |
| Schema / Compose configurations | Prisma schema and base+development/test/acceptance/production configurations validate | Container command results; production log |
| Production configuration / unsafe startup | Safe synthetic HTTPS settings accepted; HTTP/weak secret rejected; insecure-cookie API/worker startup rejected | [Production log](artifacts/ch10-production.log) |
| Backup / isolated restore | All 20 table hashes and 30 rows match, including eight migration records; frozen score 75, comments/check-ins and parent-to-child alignment retained | [Seed manifest](artifacts/ch10-restore-seed.log), [Backup](artifacts/ch10-backup.log), [Restore](artifacts/ch10-restore.log), [Verification](artifacts/ch10-restore-verify.log) |
| Administrator CLI | Explicit new verified platform account created in isolated test database; zero memberships granted | [Bootstrap log](artifacts/ch10-bootstrap.log) |
| Container/log checks | API/worker run as node; application/database/web logs rotate 10 MB x 3; live query/header markers absent and safe access record present | [Container settings](artifacts/ch10-container-settings.log), [Live log probe](artifacts/ch10-log-hygiene.log) |
| Final local runtime / fixture cleanup | Frontend 200, health ok, database connected, eight migrations; self-hosted, signup disabled; zero fixture users/outbox | [Final smoke](artifacts/ch10-runtime-smoke.log) |

Browser runs use Chromium at desktop 1440 x 960 and emulated iPhone 13 mobile widths, the real built app/API and zero test retries. The 47 scenarios produce 94 distinct desktop/mobile checks; repeated modes/runs are not additional tests. Combined distinct coverage is **217 checks**: 24 unit/API + 99 PostgreSQL + 94 browser. Mode-specific skips are exercised in their applicable runs.

Representative screenshots were inspected for desktop overview and graph cards, mobile collapsed graph/details/platform/navigation; existing keyboard/focus/overflow/card-coordinate assertions pass. Screenshots are under each browser evidence directory. No formal accessibility or cross-browser certification is claimed.

## Isolation and Corrections

Release verification used `docker-compose.acceptance.yml` with project **okr-release-acceptance**, a newly created network/empty database volume and loopback ports 8091/18025. Its synthetic credentials, test-rate settings and enabled signup do not belong in the review or production runtime. The normal localhost:8080 services and existing user data stayed separate. Integration checks used `okr_ch10_test_release`; restore used a newly named `okr_restore_*` database without starting API/workers against it. Temporary project containers/volumes and the synthetic dump were removed after verification. Evidence logs/screenshots remain; no real account was promoted.

Three verification defects were corrected:

- The production verification script retained the final deliberately rejected native command's exit code. Successful verification now returns zero; unsafe configuration rejection remains checked.
- The restore fixture had reversed alignment endpoints. It now seeds and verifies parent-to-child alignment and preserves the completed child's prerequisite override.
- Browser tests now await actual graph filter URL/results before screenshots and sign-out completion plus successful recovery before expecting mail. Initial SMTP runs exposed detached screenshot/stale-CSRF timing failures; they remain in `ch10-smtp.log` and `ch10-smtp-final.log` and are superseded by the clean complete verified run. No application security checks were weakened.

The restore/test helpers now also permit explicitly named CH10 test databases. A reusable `scripts/release-smoke.mjs` checks readiness, migrations, runtime signup/email mode and scoped fixture cleanup. No application API/UI/schema/dependency change was needed for CH10, and no release-blocking defect remains in the exercised workflows.

## Reproduce the Main Acceptance Runs

Run from the repository root with Docker Desktop. Use this separate project; never apply acceptance settings to production. Inspect whether its volume already exists before treating startup as an empty-volume check. Host Node/PostgreSQL are not required.

```powershell
$releaseCompose = @('-p','okr-release-acceptance','-f','docker-compose.yml','-f','docker-compose.acceptance.yml')
docker compose @releaseCompose build api web tools browser
docker compose @releaseCompose --profile workers up -d --no-build --wait db api worker web
docker compose @releaseCompose exec -T db createdb -U okr okr_ch10_test_release
docker compose @releaseCompose run --rm --no-deps tools node /workspace/scripts/run-isolated-checks.mjs okr_ch10_test_release
docker compose @releaseCompose run --rm --no-deps -e EVIDENCE_DIR=/evidence/ch10-selfhosted browser npx playwright test --retries=0
$env:TEST_EMAIL_MODE='smtp'
docker compose @releaseCompose --profile mail --profile workers up -d --no-build --wait api worker web mailpit
docker compose @releaseCompose run --rm --no-deps -e EVIDENCE_DIR=/evidence/ch10-smtp browser npx playwright test --retries=0
$env:TEST_DISABLE_SIGNUP='true'
docker compose @releaseCompose --profile workers up -d --no-build --wait api worker web
docker compose @releaseCompose run --rm --no-deps -e EVIDENCE_DIR=/evidence/ch10-disabled-smtp browser npx playwright test tests/e2e/signup-settings.spec.ts --retries=0
Remove-Item Env:TEST_EMAIL_MODE
docker compose @releaseCompose --profile workers up -d --no-build --wait api worker web
docker compose @releaseCompose run --rm --no-deps -e EVIDENCE_DIR=/evidence/ch10-disabled-selfhosted browser npx playwright test tests/e2e/signup-settings.spec.ts --retries=0
Remove-Item Env:TEST_DISABLE_SIGNUP
```

These commands assume the test database name is new. Check each exit code before continuing; leave concurrent integration fixtures/workers in different databases. [README](README.md) has persistence, production preflight, bootstrap, outbox and binary-safe backup/restore commands. To use its PowerShell operational scripts with this test project, temporarily set `COMPOSE_PROJECT_NAME=okr-release-acceptance` and restore its previous value afterward. Only remove this project's recorded test volume after verifying its ownership; never delete the normal runtime volume. Include both active profiles for cleanup: `docker compose @releaseCompose --profile workers --profile mail down --volumes`.

## Review and Deployment Limits

Sign in at **http://localhost:8080** with an existing account. Public signup defaults to disabled; invited users can create accounts. [Administrator onboarding](README.md#platform-administrator-onboarding-ch09) explains explicit create/promote commands; bootstrap alone grants no organization membership. Create an organization through the normal UI if needed.

Review compact graphs/collapse stability, role/tenant boundaries, explicit completion versus Achieved, collaboration/history, invitation onboarding and the operational runbook. CH10 is the final planned chapter; stop for R010 review. Review acceptance remains the user's decision.

Before an external deployment, operators still need their real HTTPS proxy/certificate, strong secrets, SMTP service when selected, backup retention and monitoring. External proxies currently share IP throttles. Graph snapshots are unbenchmarked for large organizations; notifications poll, collaboration mail/push is excluded. SMTP can deliver at least once across a crash; retries do not renew links. Token/status/audit deletion is not automated. Disaster cutover must revoke restored sessions/action/invitation links and review queued mail before traffic/workers. No optional demo seed command is shipped. SSO, HR/billing, private uploads and external product integrations remain outside PRD scope.
