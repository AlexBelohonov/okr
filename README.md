# OKR Workspace

React/TypeScript OKR application, TypeScript API, and PostgreSQL, delivered chapter by chapter with Docker Compose. Product specification: [PRD.md](PRD.md). Development chapters: [DEVELOPMENT.md](DEVELOPMENT.md). Resume point: [PROGRESS.md](PROGRESS.md). Revision reviews: [REVIEWS.md](REVIEWS.md).

## Current Delivery

R018 explains why a graph line cannot be changed: cancellation, completion, archiving, or missing edit access. Select the line to see an in-canvas notice and **Open objective**. Reopen cancelled/completed objectives through their Lifecycle controls before changing alignment; existing API rules still apply. Builds/compilation and all 86 objective/graph desktop/mobile checks pass, zero retries. Review at **http://localhost:8080/alignment**.

R017 prevents objective cards from landing on one another: crowded drops settle into the nearest clear position with a 32px gap while other cards stay put. Saved overlaps and collisions after refreshed data are corrected too. Both graph views retain personal positions and reset. Docker builds/compilation and all 82 objective/graph desktop/mobile checks pass with zero retries. Ready for review at **http://localhost:8080/alignment**.

R016 makes graph cards draggable, keeps side connection points visible on isolated objectives, and supports **Delete** on selected relationship lines through the existing confirmation. Moved positions persist in your browser tab, scoped to your membership and graph type; **Reset card positions** restores automatic layout. Drag the card body to arrange it, or a side point to create a line. Docker build/compilation and all 46 affected desktop/mobile checks pass, zero retries. Review at **http://localhost:8080/alignment**.

R015 adds new graph lines by dragging between card connection points, plus confirmed dependency-line removal and equivalent keyboard/touch controls. Objectives now have at most one alignment parent, enforced by the API and a PostgreSQL partial unique index; prerequisites still allow multiple incoming links. This supersedes earlier shared-parent behavior. Ten migrations are installed. Docker builds, 29 unit/API + 124 PostgreSQL checks and 40 affected desktop/mobile checks pass. Review at **http://localhost:8080/alignment**.

R014 adds direct alignment-tree line editing: select a line and drag either endpoint to change its parent or child, or use the keyboard/touch controls below the graph. Link identity/weight and unrelated connections are preserved; the API enforces permissions, lifecycle, versions and cycle rejection atomically. R013 parent controls remain available. Docker builds, 29 unit/API + 120 PostgreSQL checks and 32 affected desktop/mobile checks pass. Review at **http://localhost:8080/alignment**; see PROGRESS/REVIEWS for exact evidence and limits.

R012 adds outbound Slack notifications and objective updates in **Organization settings → Slack integration**. Organization owners/admins select event categories, save an encrypted incoming webhook, queue a test, inspect delivery status, pause/disconnect and retry failures. Progress snapshots and links retain the correct organization. Backend and desktop/mobile checks use the real app API and mocked Slack transport; a real Slack connection requires your webhook. Setup is documented below.

R011 adds [single-EC2 Terraform deployment](infra/terraform/ec2/README.md): a dedicated VPC, one Compose host for the complete app/database, persistent encrypted storage, private release packaging, HTTPS and Session Manager access. Region/domain are configurable; public signup defaults to disabled and invitation onboarding stays available. Infrastructure/configuration tests and the packaged production stack are verified locally. Actual AWS provisioning and public certificate issuance were not performed; the runbook contains the operator deployment commands.

R010 / CH10 completes integrated release verification. Docker builds/typechecking, 24 unit/API and 99 PostgreSQL checks pass. Complete desktop/mobile browser acceptance passes 90 self-hosted checks (four expected mode skips), 92 SMTP checks (two expected disabled-signup skips), and four disabled-signup/login/invitation checks in each email mode, all with zero retries. Repeated modes are not extra tests: 217 distinct checks overall. Fresh-volume migration, restart persistence, database readiness, production guards, explicit administrator CLI, log hygiene and hash-matched isolated restore pass. The normal application is available at **http://localhost:8080**, with self-hosted email and public signup disabled; invitation onboarding remains available. See [RELEASE.md](RELEASE.md) for commands/results/limits and [REQUIREMENT_TEST_MATRIX.md](REQUIREMENT_TEST_MATRIX.md) for complete coverage. R010 is ready for review; external production deployment remains operator work.

R006 / CH06 adds multiple alignment parents, parent-specific child weights and live ancestor rollups, prerequisites with completion overrides, relationship editing/history and filtered graph/list views to the delivered accounts, organization administration and core OKRs. Overview uses unique objective totals and real active progress. The R006 review follow-up adds lead avatars/team icons, a responsive right-side objective details/edit panel and aligned destructive controls. The second follow-up adds horizontal graphs without arrow labels, collapsible filters and atomic child creation from the selected objective.

R007 / CH07 adds verified atomic check-ins, permanent comments, organization activity, progress snapshots, assignment/comment/check-in notifications, per-objective mute preferences and trusted-host mail diagnostics/retry. Signup never grants platform-admin rights.

R008 / CH08 completes grouped desktop/mobile navigation, dashboard shortcuts, explorer/My objectives filters and pagination, team-to-objective/graph links, detail section navigation and URL recovery across reload/sign-in. Mobile navigation contains keyboard focus and restores it on dismissal; navigating or switching organization focuses the current page. The frontend retains server permissions, versions, graph scoring and immutable collaboration behavior. Large-organization performance and formal accessibility certification are not established by this chapter.

R009 / CH09 adds explicit host administrator bootstrap, protected global account/organization activation and platform history, version/reason/audit checks, global owner/offboarding safeguards, production configuration checks and an exercised isolated restore runbook. Builds/typechecking and all 24 unit/API + 99 PostgreSQL checks pass. Affected desktop/mobile browser runs with zero retries: self-hosted 16 pass + 4 expected mode-specific skips; SMTP 10 pass with real Mailpit delivery; default-disabled signup 4 pass. Repeated scenarios/modes are not extra distinct tests. Restore matches all 20 tables/30 rows; production startup rejection and live API/Nginx log hygiene pass. Evidence is under artifacts/ch09-*. Local runtime is restored with signup disabled; external TLS deployment and integrated release verification remain outside this chapter.

Verification includes workspace typechecking/builds, migrations, account security/database tests, desktop/mobile browser flows in both delivery modes, and CH02 restart persistence. Screenshots/reports are in `artifacts/`; exact current results and review evidence are in REVIEWS/PROGRESS.

Original CH08/R008 verification (before review follow-ups): Docker frontend/browser builds and shared/API/web typechecking pass; Prisma and test/development Compose configurations validate. All 20 unit/API and 86 PostgreSQL tests pass. Full built desktop/mobile acceptance passes 74 SMTP checks; self-hosted passes 72 with 2 expected SMTP-only skips. Both use zero retries, real first-party APIs and real Mailpit delivery. A final affected membership-recovery pair also passes at the desktop/mobile project widths. Total distinct checks: 180; repeated runs/modes are not extra tests. Dashboard, explorer, details, panel, mobile navigation and notification screenshots were inspected; overflow checks pass. Normal localhost/self-hosted runtime is restored, seven migrations have no pending work, and fixture cleanup reports zero test users/outbox rows. Full SMTP output is retained in artifacts/ch08-smtp.log; the HTML report reflects the final affected membership pair. Historical R007's 166 checks and earlier evidence remain in REVIEWS.

Signup startup flag follow-up: API/web/browser build and shared/API/web typechecking pass; all 21 unit/API and 88 PostgreSQL tests pass. Real-API desktop/mobile acceptance passes 8 enabled-signup checks with 2 expected SMTP-only skips, and 4 disabled-signup checks with zero retries. Public registration defaults to disabled; invitation onboarding remains available as confirmed by the user. The normal localhost runtime is restored with signupEnabled=false and zero browser fixture users/outbox rows. Logs and reports are under artifacts/r008-signup-*. Earlier layout/card verification is recorded in PROGRESS and REVIEWS.

Previous graph indicators/branches follow-up: build/typechecking, 21 unit/API and 88 PostgreSQL checks pass. All 62 distinct affected real-API desktop/mobile checks pass across the initial objective/organization regression and final clean 14-check graph run with zero retries. Achieved/Completed status, health icons, main-objective stars, collapsible shared branches, Alignment lines without arrows and generated team colors were verified before the next review revision. Logs/reports/screenshots are under artifacts/r008-graph-interactions*. Normal localhost runtime is restored with public signup disabled and zero browser fixture users/outbox rows.

Latest stable-position/health-circle follow-up: main-objective stars are removed, health indicators are green/amber/red circles, and collapse/expand retains graph card coordinates and viewport/zoom. Docker build/typechecking and 16/16 affected real-API desktop/mobile checks pass with zero retries. Screenshots inspected; normal runtime restored with public signup disabled and zero browser fixture users/outbox rows. Evidence is under artifacts/r008-stable-circles*; API/database/SMTP suites were not rerun for this frontend revision.

## Frontend Workflows (CH08)

Overview links each unarchived lifecycle count and active-on-track work to the explorer. Its active progress/overdue counts use the organization's timezone and inclusive end dates. Recently changed objectives and activity link to current objective details.

All objectives and My objectives start with collapsed filters; select **Show filters** to search or choose period, team, lead, lifecycle, archive, health, scope, dates, sorting and page size. URL-filtered visits start expanded. Hiding filters preserves results; **Clear filters** preserves sorting and page size and returns to page one. Numbered pages without results offer **Go to first page**. Opening a result carries its filtered URL into **Back to results**, including after reloading the detail page.

Team cards offer **View team objectives** and **View team alignment**. Full-page details and graph panels offer keyboard section links to metrics, relationships, collaboration, ownership, lifecycle and history. These move focus as well as scrolling; existing API permissions still decide which controls can save changes.

Member search, administrative/activity pagination and notification unread/page selection survive URL reload. Changing member search or the unread filter resets the page. Accounts without an active organization see recovery guidance on Activity/Notifications and can create an organization from Organization settings. A protected deep link keeps its query and hash through sign-in. The account name in the top bar opens settings.

## Requirements

- Docker Desktop with Linux containers and Docker Compose v2 or newer.
- Run commands from the repository root. Host Node/npm are not required.
- Default application port: 8080. Set WEB_PORT and APP_URL together if that port is occupied.

The Compose file is `docker-compose.yml`. The Docker CLI command is `docker compose`; installations with a compatible standalone Compose CLI can use `docker-compose` instead.

## Start and Stop

```powershell
docker compose up --build -d
docker compose ps
```

Open http://localhost:8080. API documentation: http://localhost:8080/api/docs/.

The migration service waits for PostgreSQL, applies committed migrations, and exits. The API starts after migration success; the web proxy waits for API health. PostgreSQL data lives in the named `postgres_data` volume. The database and API have no published host ports.

```powershell
docker compose stop
docker compose start
```

To recreate containers while retaining database data:

```powershell
docker compose down
docker compose up -d
```

Do not use `down -v` when data must be retained: it deletes project volumes.

## Development with Hot Reload

Dependencies live in a separate Docker volume; source and the lockfile remain in the workspace.

```powershell
docker compose run --rm --no-deps --build bootstrap npm ci
docker compose run --rm --no-deps bootstrap npm run generate -w @okr/api
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d
```

Use the same http://localhost:8080 URL. Vite serves React and proxies `/api` to the API; `tsx watch` reloads the API. Polling is enabled for reliable Windows-mounted frontend changes. Use both Compose files for subsequent development lifecycle commands.

Return to the built-image stack:

```powershell
docker compose up --build -d
```

After dependency changes, repeat bootstrap `npm ci` and Prisma generation. Do not overwrite the lockfile with an unreviewed dependency update.

## Containerized Checks

```powershell
docker compose run --rm --build tools npm run typecheck
docker compose run --rm tools npm test
docker compose run --rm tools npm run validate -w @okr/api
```

Integration checks require a dedicated acceptance database, with no worker consuming its queues. Slack worker tests refuse the normal database because mocked global claims could consume real messages. Use the isolated project and runner:

```powershell
docker compose -p okr-slack-acceptance -f docker-compose.yml -f docker-compose.acceptance.yml -f docker-compose.slack-test.yml build tools
docker compose -p okr-slack-acceptance -f docker-compose.yml -f docker-compose.acceptance.yml -f docker-compose.slack-test.yml up -d --wait db
docker compose -p okr-slack-acceptance -f docker-compose.yml -f docker-compose.acceptance.yml -f docker-compose.slack-test.yml exec -T db createdb -U okr okr_ch12_test_slack
docker compose -p okr-slack-acceptance -f docker-compose.yml -f docker-compose.acceptance.yml -f docker-compose.slack-test.yml run --rm --no-deps tools node /workspace/scripts/run-isolated-checks.mjs okr_ch12_test_slack
```

On rerun, reuse that database and omit `createdb`. After confirming no test commands remain, remove only this disposable project's containers/network/volumes with the same Compose flags plus `down --volumes`. Preserve the normal `okr-workspace` database.

Constraint fixtures roll back; account/objective fixtures commit real workflows then delete only uniquely identified test accounts/organizations. Integration files run sequentially because the worker claims a global outbox; individual tests still issue concurrent requests to verify races. Keep the mail worker in self-hosted mode while running integration tests so it does not consume isolated SMTP fixtures. Never run acceptance fixtures against production.

Browser acceptance uses an explicit internal Docker origin (`http://web`). The test override also sets NODE_ENV=test, increases in-memory throttle thresholds for concurrent fixtures, and gives the browser container database access for fixture setup/cleanup only. Normal runtime throttles are covered separately by integration tests. Do not leave this override enabled for human use or deployment.

```powershell
docker compose build api web browser
$env:TEST_EMAIL_MODE='selfhosted'
docker compose -f docker-compose.yml -f docker-compose.test.yml up -d api web
docker compose -f docker-compose.yml -f docker-compose.test.yml run --rm --no-deps browser
$env:TEST_EMAIL_MODE='smtp'
docker compose -f docker-compose.yml -f docker-compose.test.yml --profile mail --profile workers up -d api web worker mailpit
docker compose -f docker-compose.yml -f docker-compose.test.yml run --rm --no-deps browser
Remove-Item Env:TEST_EMAIL_MODE
docker compose --profile workers up -d api web worker
```

Browser tests use the real application, with desktop/mobile projects, real Mailpit delivery, and network-offline recovery. No first-party API is mocked. SMTP-only tests intentionally skip in the self-hosted run. Screenshots, traces, results, and reports are ignored by Git. The browser image matches the pinned Playwright dependency. Add `-f docker-compose.dev.yml` before the test override when testing source-mounted API/web; keep `--no-deps` for the browser runner so it does not replace that runtime.

For dependency diagnostics using the current workspace lockfile:

```powershell
docker compose run --rm --no-deps bootstrap npm audit
docker compose run --rm --no-deps bootstrap npm ls deepmerge-ts
docker compose run --rm --no-deps bootstrap node scripts/account-fixture-check.mjs
```

Prisma 6.19 is retained for this schema/tooling setup. A scoped `deepmerge-ts` 8 override patches its configuration dependency; schema/client generation, migration, and builds exercise that combination. Swagger UI uses its patched 6.1 release; Nodemailer 10 handles SMTP with file/URL attachment access disabled.

## Schema and Migrations

Schema: `apps/api/prisma/schema.prisma`. Ten migrations cover initial tables, domain constraints, account email/token constraints with session-revocation indexes, organization/member/team versions, planning-period versions/objective closing notes/ownership indexes, prerequisite override notes/incoming-link lookup, immutable collaboration/notification preferences, platform account versions, encrypted Slack settings/delivery queues, and a partial unique index enforcing one alignment parent. Composite foreign keys enforce organization consistency for owners, assignments, teams, relationships, comments, notifications and Slack deliveries. Organization/objective/relationship permissions and transactionally serialized graph cycle prevention are delivered. Foreign keys alone are not authorization.

Before upgrading to the single-parent migration, use the existing Relationships controls to select a parent to keep and detach extra parents. The migration refuses unresolved multi-parent data and deletes nothing automatically. Stop API/worker writers before migration and use the upgrade procedure below. The partial unique index applies only to alignment links; multiple prerequisites remain valid.

Apply existing migrations to this Compose database:

```powershell
docker compose run --rm migrate
```

Schema edits require a reviewed new migration, not `db push` against stored data. Use the bootstrap container for Prisma CLI work so generated files are written to the mounted workspace. Prisma client generation must be rerun after schema changes. Build application images again after approving a migration.

## Health, Logs, and Troubleshooting

```powershell
Invoke-RestMethod http://localhost:8080/api/v1/health
Invoke-RestMethod http://localhost:8080/api/v1/ready
docker compose logs --tail 100 api migrate db web
docker compose config --quiet
```

`health` is API liveness without a database query. `ready` checks PostgreSQL and returns 503 with a structured error when unavailable. Errors use `{ error: { code, message, requestId, details? } }`; internal exceptions and connection strings are not exposed.

If migration fails, inspect its log before retrying. If 8080 is occupied, configure WEB_PORT and APP_URL in `.env` using the variable names from `.env.example`, then recreate web. If Docker reports a Windows named-pipe permission error, confirm Docker Desktop is running and the terminal can access its Linux engine.

## Configuration and Optional Services

Compose uses `.env` when present. Defaults are for local development. Use the production runbook below for deployment configuration. An external HTTPS deployment is not part of the local verification.

| Variable | Default / Purpose |
| --- | --- |
| POSTGRES_PASSWORD | Local-only development default; select a deployment secret before production |
| APP_URL | http://localhost:8080; exact allowed browser origin and account-link origin; no trailing path/query |
| WEB_PORT | 8080 |
| NODE_ENV | development in base Compose; production in docker-compose.production.yml |
| COOKIE_SECURE | false locally; true with production HTTPS |
| EMAIL_MODE | selfhosted; smtp queues account/invitation messages and requires verified email for organization content mutations |
| DISABLE_SIGNUP | true; hides and blocks public registration. false enables it. Only literal true/false values are accepted; valid invitations still permit account creation. |
| SLACK_ENCRYPTION_KEY | Optional; 64 lowercase hexadecimal characters representing 32 random bytes. Retain the same key to decrypt saved Slack connections. |
| SMTP_HOST / SMTP_PORT | mailpit / 1025 |
| SMTP_USER / SMTP_PASSWORD | Optional SMTP credentials |
| SMTP_SECURE | false for local Mailpit |
| MAIL_FROM | noreply@localhost |

Mailpit is optional and binds its inbox to loopback only:

```powershell
docker compose --profile mail up -d mailpit
```

Inbox: http://localhost:8025. To test actual local account delivery, set EMAIL_MODE=smtp in `.env` (or the current shell) and recreate API/worker with the mail/workers profiles. APP_URL must match the URL opened in the browser exactly; `127.0.0.1` and `localhost` are different origins. Production requires implicit TLS (SMTP_SECURE=true) or successful STARTTLS; plain development SMTP is not permitted in production.

The opt-in worker delivers queued SMTP messages with exclusive row claims, up to five attempts, exponential backoff, sanitized failure messages, and removal of delivered link payloads. SMTP delivery is at-least-once: a crash after the mail server accepts a message but before DB commit can duplicate an email. Message IDs remain stable; action links remain single-use. Trusted-host status/retry and operational guidance are delivered; monitor the queue/disk/container health as described below.

```powershell
docker compose --profile workers up -d worker
```

Explicit platform-admin bootstrap, production configuration guards and tested isolated backup/restore are delivered in CH09 and integrated release verification in CH10. Use the runbooks below and never use local defaults for production. R011 supplies a [single-EC2 deployment runbook](infra/terraform/ec2/README.md), including HTTPS startup; actual deployment, SMTP and monitoring require operator setup. No demo seed command is shipped or installed automatically; acceptance fixtures require explicit isolated databases.

## Slack setup

For a local Compose installation, generate a key once with the tools container:

```powershell
docker compose run --rm --no-deps tools node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Save the result as `SLACK_ENCRYPTION_KEY` in the protected, ignored `.env` file. Preserve other settings and keep this key with your protected backups. Recreate API/worker after setting it:

```powershell
docker compose --profile workers up -d api worker web
```

The current local review runtime already has a generated key. The [EC2 deployment](infra/terraform/ec2/README.md) generates and retains its key automatically. Without a key the app remains usable and Slack setup shows unavailable. The worker is required for delivery, including in self-hosted email mode.

Create a Slack app, enable Incoming Webhooks and authorize the intended channel using [Slack's incoming-webhook guide](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/). An organization owner/admin opens **Organization settings → Slack integration**, pastes the URL, supplies a reference channel label, enables delivery and selects event categories. Slack determines the destination from the webhook; the label does not route messages. Save, then select **Send test message** and check the channel plus delivery status.

Objective changes include metrics, health, lifecycle, ownership and relationships. Check-ins qualify for either selected category; comments/assignment notifications follow the notification choice. Messages include the saved event's progress/health/state and note when present. Links select the objective's organization after sign-in. Everyone with access to the Slack channel can see messages; in-app recipient/mute preferences do not limit that audience.

The webhook is encrypted in PostgreSQL and never displayed again. Delivery is serialized per integration, honors Slack rate limits and retries transient failures up to five times. **Retry failed messages** resets that budget. Saving settings discards pending/failed unsent messages; disconnect also clears stored delivery records and credentials. Successful messages have their queued content scrubbed. A crash after Slack accepts a message but before DB commit can duplicate it; an already-started request can finish during suspension/disconnection. Keep database backups and the encryption key protected, and review unsent Slack messages before restoring a live database. Actual Slack delivery has not been exercised without a supplied webhook.

## Accounts and Recovery

Public registration is disabled by default (`DISABLE_SIGNUP=true`). Sign-in has no Create account link, `/signup` redirects to sign-in, and public signup API requests receive `403 SIGNUP_DISABLED`. Existing users can sign in, and invited people can still create accounts through valid invitation links. The frontend reads this setting from the API session at runtime, so toggling it does not require rebuilding web.

To enable public registration, set `DISABLE_SIGNUP=false` in `.env` and apply it:

```powershell
docker compose up -d api
```

For a new installation, use the explicit administrator bootstrap below; public signup can stay disabled. Sign in and create an organization from **Organization**. If public signup is enabled, open `/signup`. Passwords require 12-128 characters. Select a valid timezone. In self-hosted mode, public-signup email stays visibly unverified; in SMTP mode a verification email is queued and organization content mutations require verification. Invitation possession verifies its bound email; reset links do not implicitly verify email.

Browser acceptance overrides registration to enabled for existing account fixtures (`TEST_DISABLE_SIGNUP=false`). Use `TEST_DISABLE_SIGNUP=true` with `docker-compose.test.yml` to test the disabled configuration; run `tests/e2e/signup-settings.spec.ts` in that mode. The default base runtime remains disabled.

`/login`, `/forgot-password`, `/reset-password#token=...`, `/verify-email#token=...`, and `/invitation#token=...` are public account routes. `/overview` and `/settings` require a current active session. Settings lets you edit your name, change password, sign out, and resend verification in SMTP mode. Email-address changes are intentionally unsupported. Password changes/resets revoke every session, including the current one; sign in again.

Sessions expire after seven days. Verification expires after 24 hours, reset after 30 minutes, invitation after seven days. Reissuing an action link invalidates earlier unused links of that type; links are single-use. Recovery always gives the same response for known/unknown addresses, includes a small timing floor/jitter, and queues no mail in self-hosted mode. Without SMTP, contact a trusted host operator.

Every account mutation requires JSON, the exact APP_URL Origin, and X-CSRF-Token obtained from GET `/api/v1/auth/session`. Session and anonymous CSRF cookies are HttpOnly/SameSite=Lax; production uses Secure. Authentication cookies rotate on login; session/action bearer tokens are SHA-256 hashes in their lookup tables. Argon2id password hashes use 64 MiB, three iterations, one lane. Nginx overwrites forwarded client IPs; the API trusts only its direct proxy hop. Do not publish the API port or change this topology without revisiting trust configuration.

Public account endpoints: GET `session`; POST `signup`, `login`, `logout`, `recovery`, `reset`, `verification`, `verify`, `invitation`, `accept-invitation`; PATCH `profile`; POST `password`, all under `/api/v1/auth/`. OpenAPI lists these routes. Responses never include password hashes/session bearer tokens. Tokens travel in URL fragments and POST bodies, not URL queries; request logging does not log bodies, cookies, or authorization headers.

## Trusted-Operator Links

A trusted infrastructure operator can issue copied reset/invitation links with the container-only command below. Invitations also have a member-admin UI. This command has direct database access: it is not an HTTP endpoint, and knowing the actor's email does not grant terminal access. Treat access to Docker/database credentials as privileged. It checks an active owner/admin actor, active organization, and active target membership for resets, and records an audit event. Never expose it as an ordinary-user endpoint; a global-account reset affects every organization membership.

Obtain organization UUID from the signed-in GET `/api/v1/auth/session` response (browser Network panel). Replace the example UUID/emails with that organization's active owner/admin and the intended recipient:

```powershell
docker compose run --rm --no-deps tools npm run account:link -w @okr/api -- --type reset --org YOUR-ORG-UUID --actor owner@example.com --email member@example.com
docker compose run --rm --no-deps tools npm run account:link -w @okr/api -- --type invite --org YOUR-ORG-UUID --actor owner@example.com --email invited@example.com --role member
```

The command prints a sensitive link once. Send it privately to the intended recipient; never paste it into logs or public tickets. Invitations default to member; supported invite roles are admin/manager/member/viewer, not owner. An existing invited account signs in, then accepts the link; new recipients create an account on the invitation screen. Existing memberships are not silently promoted/reactivated by an invitation.

Add `--send` in SMTP mode to atomically queue an email as well. Copied links work in either mode. Delivery requires the worker. The outbox temporarily contains plaintext link payloads needed for SMTP, then scrubs them after successful delivery; protect the database, backups, and Mailpit inbox as sensitive. Five failed attempts retain a sanitized error and the payload; maintenance/retention and operator retry UI are later-chapter work.

## Organizations and Administration

After signing in, use **Organization** to edit the selected organization's name/timezone or create another organization. The sidebar organization selector switches the workspace; selection survives reload within that browser tab and is scoped to the signed-in account. The API checks each requested organization independently. If a membership is suspended, other memberships and the account session remain usable.

On **Members**, expand **What do the roles mean?** for brief owner/admin/manager/member/viewer explanations. Member and invitation forms also explain the selected role beneath the dropdown. Invitation recipients see that explanation before joining.

**Members** provides name/email search and pagination. Owners/admins change roles or activation and issue invitations. Only owners can change an owner role. At least one active owner with an active global account must remain. **Transfer ownership** selects an active member, promotes them to owner, and makes you an admin; it preserves other owners. Stale changes show a conflict: choose **Reload**, review the current values, and submit again.

Invitation links expire in seven days and can be selected/copied in either delivery mode. Clipboard support depends on browser context; manual selection/copy is available. SMTP mode offers **Send invitation email** and requires a running worker. Reissuing for the same email invalidates the prior unused link; **Revoke** closes it. Closed status covers either acceptance or invalidation/revocation. Existing memberships require explicit role/reactivation updates. Invitations cannot grant owner status. Copied reset links remain a trusted host-operator command because they reset the global account.

**Teams** lets owners/admins create/rename/delete teams, add/remove active members, and appoint designated managers. Designations require the manager/admin/owner role. Managers can rename and manage ordinary rosters of designated teams, but cannot edit unrelated teams, administer organization members, appoint/remove designated managers, or delete teams. All active members can read teams and the active member directory. **Administration history** is restricted to owners/admins and shows actor/time/action with pagination; it exposes no link credentials.

Suspension or demotion below manager/admin/owner clears manager designations in the same audited transaction. Suspension or viewer demotion also refuses objective lead, co-owner/contributor, and key-result-owner references until reassigned, including archived objectives. Use objective detail's ownership and metric-owner controls to clear those references before changing membership. Teams with objectives cannot be deleted. Global account/organization suspension controls and explicit platform bootstrap are delivered; see Platform Administrator Onboarding below.

Organization/member/team mutations use the same session, Origin, JSON and CSRF requirements as accounts. API resources under `/api/v1`:

| Method/path | Delivered behavior |
| --- | --- |
| POST `/orgs` | Create organization and owner membership |
| GET/PATCH `/orgs/:orgId` | Organization/current membership; edit name/timezone with version |
| GET `/orgs/:orgId/members` | Search/paginate (`search`, `page`, `limit`) |
| PATCH `/orgs/:orgId/members/:id` | Role/activation with membership version |
| POST `/orgs/:orgId/transfer-ownership` | Transfer with actor/recipient membership versions |
| GET/POST `/orgs/:orgId/invitations` | Status list; copied/optionally emailed invitation |
| DELETE `/orgs/:orgId/invitations/:id` | Revoke unused invitation; send JSON `{}` |
| GET/POST `/orgs/:orgId/teams` | List/create teams |
| PATCH/DELETE `/orgs/:orgId/teams/:id` | Rename/delete with team version |
| PUT/DELETE `/orgs/:orgId/teams/:id/members/:membershipId` | Add/designate/remove with team version |
| GET `/orgs/:orgId/audit` | Paginated administrative audit |

Versions start at 1 and increase on changes. Team roster changes increment the team version. New organization creation requires verified email in SMTP mode; initial account/signup onboarding is the bootstrap exception.

## Planning and Objectives

Open **Planning periods** to create a calendar quarter or custom inclusive range. Owners/admins manage periods; everyone can read them. Used periods can be renamed, but moving their dates or deleting them requires moving all referenced objectives first. Objectives may instead use custom dates without a named period.

Use **All objectives** or **My objectives**, then **New objective**. Set title, scope, description, dates/period, lead and assignments. Ordinary members create their own personal objectives or objectives for teams they belong to; managers/admins create company objectives. All active members can read organization objectives. Leads, co-owners, designated team managers and admins have structural edit rights; contributors and metric owners can update current values. Viewers can follow objectives.

Add numeric increasing/decreasing or binary key results. Numeric baseline/target must differ; binary outcomes use 0/1. Progress clamps to 0-100% and uses positive weights: `(sum of score × weight) / sum of weights`. No inputs produces 0%. Current values can pass the target. Choose either key-result scoring or weighted direct aligned children. Active/completed unarchived children contribute; draft/cancelled/archived children are excluded. A shared child can contribute to several parents using a different weight for each. Switching modes preserves metrics and links while using only the selected inputs.

Complete active objectives with a closing note to freeze their score. Closed/archived work blocks structure and metric values; reopen/unarchive to resume edits. Ownership and metric-owner reassignment remain available on closed/archived work and preserve the final score/note. Archive preserves objective history. Removed key results retain their previous values in audit history. Reload after a conflict: metric writes require both metric/objective versions and advance both so a stale completion cannot freeze an outdated score.

Explorer search/period/team/lead/lifecycle/archive/date filters and sorting survive reload in the URL. Date ranges use inclusive overlap, not containment. My objectives includes leads, all assignments and metric ownership once per objective. Overview averages/overdue counts include only active unarchived work; an objective is overdue after its end date in the organization timezone. Change history records actors, metric changes and lifecycle notes. Check-ins, comments, activity and notifications are delivered in R007 below.

API resources under `/api/v1/orgs/:orgId`: `periods`, `objectives`, `objective-summary`, objective `ownership`, `lifecycle`, `archive`, `follow`, `key-results`, metric `current`/`owner`, and objective `history`. All mutations reuse session/Origin/CSRF/SMTP verification checks and serialized tenant transactions. API docs list the implemented endpoints.

## Alignment and Prerequisites

Open an objective's **Relationships** section and choose **Connect objective** to add a parent, child, prerequisite or dependent. Search the real objective directory, select a result and set an alignment weight. Alignment requires editing rights on both live endpoints. Prerequisites require editing rights on the dependent and visibility of the prerequisite. Graphs reject duplicate/self/foreign links and cycles, including concurrent opposing requests. Reopen/unarchive endpoints before changing locked relationships. Cross-period links are allowed and differences stay visible.

Parent management (R013/R015): open an objective on **Alignment**, then use **Relationships**. **Attach parent** is available when the objective has no parent, and adds one existing editable objective with a chosen weight. **Detach parent** requires confirmation and leaves the objective as a root. **Change parent** → select a new parent → **Save parent** atomically replaces its parent, retaining the weight and unrelated relationships. Failed changes keep the current parent. All three objectives must be live, unarchived and editable. API checks include versions, tenant, cycles and one-parent cardinality. **Reload relationships** clears a stale change form. Graph/list/rollups refresh after saving. Full-page details use the same controls; child pickers exclude already-parented objectives, including parents outside the current graph filters.

Unfinished prerequisites warn without preventing work or changing numeric progress. Before completing a dependent, supply both a closing note and a separate **Prerequisite override note** if any direct prerequisite is not completed. Cancelled and archived unfinished work still warns. The closing assessment and history retain the override; reopen clears the current assessment but preserves its audit.

Use **Alignment** in the sidebar for alignment or prerequisite graphs. Solid Alignment lines without arrowheads connect parent to child; dashed amber arrows run prerequisite to dependent. Both graphs read left to right. Arrow labels are omitted; contribution weights still determine child-mode scoring and remain in relationship settings/list connections. Graph controls zoom and fit. Use **Show filters** / **Hide filters** to collapse filters without clearing them; a summary keeps the graph type and active-filter count visible. Unfiltered visits start collapsed; URL-filtered visits start expanded. Click a node, use Enter/Space on a focused node, or open an objective from the connection list to show a right-side details panel. Both graphs and lists display the lead avatar/name and an icon for scope; scope/team names are available in the icon tooltip and accessible label. Compact graph cards have a pale teal title row, a subtle divider and tight spacing before the owner/progress information; single-line titles do not reserve a blank second line. Graph cards are 253px wide and 80px tall, fitting exactly three compact rows: tinted title, lead/scope icon, then right-aligned percentage and lifecycle. Warning icons with full accessible labels/tooltips share the third row without adding height; details and the connection list retain expanded warning information. Selected cards keep the same dimensions. Cards omit dates/planning periods; long titles stay on one line with ellipsis, with full titles in the tooltip, accessible node name and details panel. A subtle green card tint indicates 100% progress and clears if progress drops below 100%; lifecycle state still appears separately. The graph canvas grows with the viewport; **How to read relationships** expands the graph help when needed. Explorer and overview cards also omit dates and use scope icons. The panel contains the description, dates, progress, key results, relationships, ownership, lifecycle and history. Existing permissions determine which updates are available; viewers can read, contributors update eligible metrics, and editors manage their work. Saves refresh the graph while the panel stays open; stale edits report conflicts and recover with **Reload objective**. Use Escape or the close button to return to the graph, or **Open full objective page** for the full view. On mobile the panel fills the width and scrolls independently. Choose **Create child objective** on a live objective you can edit to create and align a new child directly in the panel, from either graph view. The form starts with the parent’s dates/planning period and your personal scope/lead, which you can change under normal permissions. Save creates the child and parent alignment together with default contribution weight 1; permissions, parent version and audits are checked atomically, so failed/stale saves leave no orphan. The panel keeps the parent open and offers opening the child. **Cancel child objective** creates nothing. Relationship/key-result removal uses styled destructive controls and an explicit confirmation. Filters survive reload; badges disclose connections outside the filters. Both views show unique objectives. Graph rendering loads only when needed. Use each parent's chevron to **Collapse children** or **Expand children**, or **Expand all children** to reset. Each child has one parent; collapsing a branch hides its descendants on the canvas. Collapsing/expanding changes visibility without moving the remaining cards or changing the current zoom; both graph types calculate positions from the complete matching graph. Collapsing affects the canvas only, retains all matching objectives in the list, and persists for your membership in browser-tab storage. Small green, amber and red circles indicate **On track**, **At risk** and **Off track**, with full tooltips and accessible labels. Active objectives at 100% show **Achieved**; use the explicit completion action and closing note to obtain **Completed**. Teams receive stable generated colors on graph headers and card/list accents, including the team directory; the green 100% tint retains the team accent.

Tree line editing (R014): on **Alignment**, select a line (click/tap, or focus it and press Enter/Space) to reveal its draggable endpoints. Drag its left endpoint to another objective's right connection point to change its parent, or drag its right endpoint to another objective's left connection point to change its child. Both endpoints can move, one at a time. Selection also shows **End to move**, **Reattach to objective**, and **Reattach line** controls below the graph. Choices follow the graph filters, editing rights and live state; already-connected replacements are excluded. The same link and weight are retained. Rejected changes and drops on empty space keep the original relationship. **Reload alignment** refreshes stale versions before trying again. Expand collapsed branches or adjust filters to reveal more drag targets. Prerequisites retain their existing details controls.

Creating/removing graph lines (R015): drag from a card's right connection point to another card's left point, or start at the left point and finish at the right. The current graph chooses alignment or dependency. A new alignment has weight 1 and requires an unparented child and two live editors; adding a second parent is rejected. Choose **Connect objectives** for equivalent keyboard/touch controls. In **Prerequisites**, select a line, choose **Remove dependency line**, then **Confirm remove dependency**; **Cancel line removal** keeps it. Selection also allows alignment-line removal. Both objective records remain. Dependency creation/removal requires a live editable dependent and a visible prerequisite, which may be closed/archived or read-only. Reattachment retains the previous controls, but the replacement child must have no parent. Saves refresh the graph/list and return focus to the graph region; stale operations retain the relationship and offer reload.

Card movement and keyboard removal (R016): side points are always visible, including cards with no lines or parents. Teal points allow connection gestures; gray points indicate an unavailable gesture. Drag a card's body to rearrange it. Positions survive collapse, filters, graph reloads, relationship saves and page reloads in the same browser tab; Alignment and Prerequisites keep separate layouts. **Reset card positions** clears the current view's custom positions. Layout movement is personal and does not edit the objective or its relationships. Select an editable line by clicking/tapping it or focusing it with the keyboard, then press **Delete**. The confirmation receives focus; press Enter to remove the relationship, or cancel to keep it. Delete while focused on an objective card or editing a field does not remove a line/objective. Removal still uses the real versioned API and its permission/lifecycle checks.

POST `/api/v1/orgs/:orgId/links/:linkId/reconnect` accepts `end` (`parent` or `child`), replacement `objectiveId`/`objectiveVersion`, and the original `sourceVersion`/`targetVersion`. All three objectives require editing rights and live, unarchived state. The API serializes changes, rejects duplicates/self/cycles/foreign endpoints and commits link changes, version invalidations, histories and Slack queues together. The existing `/reparent` API remains supported.

Child creation API: POST `/api/v1/orgs/:orgId/objectives/:id/children` accepts the ordinary objective creation fields plus required `parentVersion`, returns the created child with its post-alignment version, and atomically creates a weight-1 alignment. It requires a live parent editor, valid creation scope/references and edit rights on the new child. Parent/child/ancestor versions and both endpoint histories advance together under the existing organization lock.

Relationship APIs under `/api/v1/orgs/:orgId`: GET `graph`, GET `objectives/:id/relationships`, POST `links`, PATCH/DELETE `links/:linkId`. Creating a link accepts `sourceId`, `targetId`, `type`, optional alignment `weight`, `sourceVersion`, `targetVersion`. Updating/deleting accepts both endpoint versions (plus `weight` for alignment updates). Lifecycle accepts `overrideNote` in addition to `note`. All writes serialize with metrics/completion, advance affected versions and commit audits atomically. Reload after conflicts. Child scores are calculated from tenant snapshots; completed scores remain frozen. These graph snapshots currently load organization data in memory; large-organization performance is not yet benchmarked.

## Check-ins, Comments and Notifications

Open an objective or its graph panel and choose **New check-in**. Add a note, health and any changed metric values, then **Post check-in**. Editors/contributors can change all metrics; key-result owners can change their own. Values, health, score snapshot, immutable history and recipient notifications save together. Reload after a stale-version conflict; the form reloads current values. Check-ins require live draft/active work. Record corrections as new entries. The progress chart shows snapshots from the current page of check-ins, oldest to newest; exact dates, health and scores appear in the list. Expand **Metric snapshot** for captured definitions/values and changes. Comments are permanent entries; active non-viewers can discuss closed/archived work too.

**Activity** shows paginated objective events and notes for the selected organization, including archived work. **Overview** shows the five newest objective events. Administrative events remain in restricted Administration history.

**Notifications** lists assignment changes, comments and check-ins for current participants/followers, excluding the actor and inactive recipients. Assignment notifications include affected old/new roles and metric ownership; ordinary title/date/metric edits do not broadcast. Use **Follow objective** to subscribe, **Mute objective notifications** to silence this objective, or **Enable objective notifications** to restore delivery. Mute persists independently of assignments. The Members search and Notifications unread filter both have **Show filters** / **Hide filters** controls that preserve URL values and results; unfiltered visits start collapsed and visits with an applied filter start expanded. Unread filtering, read/unread, mark-all-read and links are available; opening a link marks its notification read and the destination rechecks current access. Counts refresh after actions, on focus or every 30 seconds in the sidebar. Notifications are in-app; SMTP remains for account/invitation messages.

API resources under `/api/v1/orgs/:orgId`: GET/POST `objectives/:id/check-ins`, GET/POST `objectives/:id/comments`, GET `activity`, PUT `objectives/:id/notification-preference`, GET `notifications`, PUT `notifications/:id/read` and PUT `notifications/read-all`. Check-ins accept `note`, `health`, `version` and `metrics: [{ id, current, version }]`; preference accepts `{ enabled }`; read accepts `{ read }`; read-all accepts `{}`. Lists accept page/limit; notifications also accept unread=true. Check-in/comment update/delete routes do not exist. All writes enforce session/Origin/CSRF and current tenant access; content writes require SMTP verification.

## Mail Delivery Diagnostics

These commands require trusted host/Docker access. They are global operations, unavailable to ordinary tenant administrators through HTTP:

```powershell
docker compose exec api npm run mail:status -w @okr/api
docker compose exec api npm run mail:status -w @okr/api -- --retry OUTBOX_UUID --actor active-operator@example.com
docker compose logs worker --tail 50
```

Status reports deliveryEnabled, sent/pending/retrying/failed counts, latest 50 status rows and oldest 50 exhausted failures. Rows omit recipients, subjects, payloads and raw errors. Self-hosted deliveryEnabled=false is expected. SMTP mode requires the optional worker (`docker compose --profile workers up -d worker`); status reflects database outcomes rather than proving the worker is alive. Check worker logs and Compose status if pending mail stalls. In production use the same production Compose overlay for these commands.

Automatic attempts stop after five failures, using 30/60/120/240/480-second backoff. Retry accepts only exhausted unsent rows, resets the five-attempt budget and records an audit with the active actor account. It never renews a token: reissue expired/replaced verification/reset/invitation links through their existing workflows. Sent messages cannot be resent through retry. Delivery across a crash after SMTP acceptance remains at-least-once; action links stay single-use. Sent payloads are scrubbed, while expired token/status/audit rows have no automatic deletion policy. Choose protected backup retention and disk/queue monitoring appropriate to your installation; CH09 does not provision a monitoring service.

## Database Persistence Check

This optional development check creates a uniquely identified isolated organization record, verifies it survives a database restart, then removes only that record. Run it when restarting this local database is acceptable.

```powershell
docker compose run --rm --no-deps bootstrap node scripts/persistence-probe.mjs create
docker compose restart db
docker compose run --rm --no-deps bootstrap node scripts/persistence-probe.mjs verify
```

Probe metadata is stored in `artifacts/persistence-probe.json` until verification. Other application data is untouched. The isolated dump/restore runbook follows below.

## Platform Administrator Onboarding (CH09)

Create the first administrator explicitly after migrations. This works with `DISABLE_SIGNUP=true`; no first-user privilege is inferred. PowerShell prompts for a password without echoing it; the password goes to stdin, never a command argument. Use a real email address and name:

```powershell
$adminCredential = Get-Credential -UserName admin@example.com -Message 'New platform administrator password (12–128 characters)'
$adminCredential.GetNetworkCredential().Password | docker compose run --rm -T api npm run platform:bootstrap -w @okr/api -- --email admin@example.com --name 'Platform Administrator' --password-stdin
Remove-Variable adminCredential
```

The trusted host command creates an active, verified account and one global audit event. Host operators attest the email address; no organization membership is granted. Sign in at http://localhost:8080, open **Organization**, and create an organization if needed. The same account then owns that organization through the normal API. Public signup and invitations never grant platform rights.

Promote an existing active account explicitly, preserving its password/name/verification and organization memberships:

```powershell
docker compose run --rm -T api npm run platform:bootstrap -w @okr/api -- --email existing@example.com
```

Repeat promotion is idempotent and emits no duplicate audit. Inactive accounts must be reactivated through an existing administrator; promotion does not silently reactivate them. New accounts require both name and password; existing accounts reject those options. Commands print only ID/change metadata, never credentials. For production use `-f docker-compose.yml -f docker-compose.production.yml` on both commands. Docker/database access is trusted infrastructure access; the bootstrap audit records the target account and `source=trusted_host`, not an authenticated OS operator identity.

**Platform administration** (`/platform`) appears only for platform administrators and works without tenant membership. Accounts, Organizations and Platform history have searchable, paginated lists and collapsible filters. Activation changes require confirmation, a reason and the current version. Stale writes return 409; use **Reload** before retrying. API paths are GET `platform/users`, `platform/organizations`, `platform/audit`, and PATCH `platform/users/:id`, `platform/organizations/:id` with `{ active, version, reason }`, all under `/api/v1`.

Suspension revokes global sessions/action tokens, preserves memberships and historical authorship, and clears team-manager designations with team versions. Reassign every lead, co-owner, contributor and key-result owner first, including archived/closed work. Every organization retains a globally active owner, including suspended organizations. The final active platform administrator cannot be suspended. Reactivation does not restore suspended memberships, manager designations or revoked sessions/tokens. Organization suspension hides all its tenant content; reactivation requires an active owner. Platform access never substitutes for tenant membership. Platform audits include actor, target, before/after, reason and version and are committed atomically; these global events are separate from tenant history.

## Production Configuration and Upgrade Runbook

Use Compose 2.24.4+ for the production overlay's port replacement. Keep `.env` outside source control and restrict it and Docker access to trusted host operators. Set `POSTGRES_PASSWORD` to at least 32 random alphanumeric characters (avoids URL-encoding mistakes), `APP_URL=https://your-real-host`, `COOKIE_SECURE=true`, and an explicit `EMAIL_MODE`. Existing database passwords do not change just by editing `.env`; coordinate a database role-password rotation with application downtime. The application stores sessions/action tokens as hashes and passwords with Argon2id; there is no static session-signing secret to configure.

The overlay sets production mode and publishes web only on `127.0.0.1:WEB_PORT`. Put a host HTTPS reverse proxy in front of that port, with a valid certificate, HTTP-to-HTTPS redirect and HSTS appropriate to your domain. Preserve the browser Origin header. Do not publish db/API ports. The external proxy owns certificate renewal; the application uses the configured HTTPS origin for CSRF/cookies/links. This localhost run verifies configuration guards, not your certificate/proxy deployment. The API trusts only its direct Nginx hop and Nginx overwrites forwarded client addresses; behind an external proxy throttles therefore share its address. Revisit trusted-proxy/IP handling before changing topology.

Self-hosted mode needs no SMTP; use copied invitations and trusted-host reset links. SMTP mode requires explicit `SMTP_HOST`, `SMTP_PORT`, a domain `MAIL_FROM`, and paired `SMTP_USER`/`SMTP_PASSWORD` when authentication is used. Port 465 requires `SMTP_SECURE=true`; other ports use required STARTTLS in production when `SMTP_SECURE=false`. TLS certificate validation remains enabled. Run the worker with the production overlay. Never use Mailpit or a production database password placeholder in production.

Run the configuration check before changing live services/migrations. It prints only setting names on rejection:

```powershell
docker compose -f docker-compose.yml -f docker-compose.production.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.production.yml build api web
docker compose -f docker-compose.yml -f docker-compose.production.yml run --rm --no-deps api npm run operations:check -w @okr/api
```

For a first installation, apply migrations and start services only after the check succeeds. For an upgrade, save a verified database backup first, review migrations and compatibility, retain the previous source/images, then stop writers and migrate:

```powershell
docker compose stop web api worker
docker compose -f docker-compose.yml -f docker-compose.production.yml run --rm migrate
docker compose -f docker-compose.yml -f docker-compose.production.yml --profile workers up -d --no-build api web worker
docker compose -f docker-compose.yml -f docker-compose.production.yml ps
Invoke-RestMethod https://your-real-host/api/v1/ready
```

These forward migrations are not automatically reversible. If migration fails, keep writers stopped and inspect `migrate` logs; never use `db push` or erase volumes to repair a live install. Recover by diagnosing the migration or restoring the verified pre-upgrade dump to a fresh database with compatible previous application images. Record the chosen database/volume and test readiness before routing traffic. Do not restart an older app against a schema it cannot support. Minor application releases do not upgrade PostgreSQL's major version; a PostgreSQL major upgrade needs a separate dump/restore or supported upgrade plan.

Compose keeps PostgreSQL in `postgres_data` at PostgreSQL 18's `/var/lib/postgresql`; `down` retains it, `down -v` deletes it. API Compose health uses `/ready` and fails when the database is unavailable; `/health` remains liveness only. API/worker run as the unprivileged node user. API/web/database logs rotate at 10 MB × 3 files; request logs omit query strings, bodies, cookies and authorization. Keep operator-issued links out of shared terminal logs. Monitor disk space, database readiness, container restarts and oldest pending/exhausted outbox status; use `mail:status` and the audited retry command above for delivery issues. Avoid `docker compose config` without `--quiet` in shared logs because rendered configuration contains secrets.

## Database Backup and Isolated Restore

Run from the repository root with Docker Desktop running. Use a new protected destination outside source control; backups contain all tenant data, hashes and temporarily undelivered plaintext email links. Encrypt off-host copies, restrict access, and set a retention policy. `pg_dump` uses a consistent snapshot; no host Node/PostgreSQL installation is needed. PostgreSQL tools run in the database container. Scripts copy binary files using `docker compose cp`, avoiding PowerShell binary pipeline corruption:

```powershell
.\scripts\backup.ps1 -Destination .\artifacts\okr-backup-20261010.dump
.\scripts\restore-isolated.ps1 -Backup .\artifacts\okr-backup-20261010.dump
```

Backup refuses to overwrite an existing destination. Restore always creates a new `okr_restore_TIMESTAMP_RANDOM` database; it never cleans or overwrites `okr`. It runs `pg_restore --single-transaction --exit-on-error`, leaves a failed isolated database for inspection, and removes only its container temporary file. Read the printed database name and inspect it with `docker compose exec -T db psql -U okr -d RESTORED_DATABASE`; compare row counts/representative objectives, metrics, history, memberships and migration records before relying on the backup. No API/worker connects to the restored copy, so queued mail/action tokens remain inert. Keep it isolated; do not start a worker against a restore drill.

After verification, a trusted operator may remove only the recorded isolated database with `docker compose exec -T db dropdb -U okr RESTORED_DATABASE`, then remove the protected drill dump if not needed. Do not drop `okr`. Restoring into production is a separate downtime/cutover decision; after a real disaster restore, revoke restored sessions/reset/verification/invitation links and review queued email before enabling access/workers, because restored data can resurrect old access tokens and pending deliveries.

CH09/CH10 verification uses `scripts/restore-drill.mjs` only against an isolated `okr_ch09_test_*` or `okr_ch10_test_*` database. It seeds representative records explicitly after tests; it cannot seed the live `okr` database. This is a test fixture, not a demo seed. No demo data is automatically created. The R010 drill verifies parent-to-child alignment and a completed prerequisite override as well as matching all 20 table hashes/30 rows.

## Isolated Release Acceptance

[RELEASE.md](RELEASE.md#reproduce-the-main-acceptance-runs) gives the exercised commands. `docker-compose.acceptance.yml` names a separate `okr-release-acceptance` project with its own database volume/network, synthetic credentials, loopback web port 8091 and Mailpit port 18025. Always supply `-p okr-release-acceptance -f docker-compose.yml -f docker-compose.acceptance.yml`; never use this overlay for human review or production. It defaults to enabled signup for account fixtures and NODE_ENV=test on API; disabled-signup acceptance runs separately in both email modes. The normal base runtime retains signup disabled and normal rate limits.

Integration checks use a newly created `okr_ch10_test_*` database in that test project. Compose operational scripts use the current project: when targeting this isolated stack, temporarily set `COMPOSE_PROJECT_NAME=okr-release-acceptance` and restore its previous value afterward. Check each exit code and the exact project/volume labels before removing temporary data. Test credentials/fixtures never belong in production.

After restoring the normal runtime, a container-only smoke checks frontend, readiness, applied migrations, configured signup/email mode and fixture cleanup:

```powershell
docker compose run --rm --no-deps tools node /workspace/scripts/release-smoke.mjs
```

The default smoke expects self-hosted email, signup disabled and eight applied migrations. Override EXPECT_EMAIL_MODE / EXPECT_SIGNUP_ENABLED explicitly for a different intentional configuration. It prints status/count metadata only; it does not alter user data or grant administrator rights.

## Chapter Review and Resume

Development stops after each chapter, as requested. R010 / CH10 is ready for review and is the final planned chapter. Review the release report/matrix and local application, or request a revision such as `revise R010 ...`. Further features or external deployment need a new explicit scope. Send `pause` during work to record the exact continuation point. Future engineers/agents read AGENTS, PRD, DEVELOPMENT, PROGRESS, and the latest review before resuming. Continuation does not imply blanket review acceptance.

The checkpoint includes changed files, actual verification results, running services, limitations, and the next task. Revision IDs refer to review checkpoints, not automatically to Git commits or deployments.
