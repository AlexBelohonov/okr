# Development Chapters

Revision: R018 | Date: 2026-10-29

## Working Agreement

`PRD.md` defines the product. This document divides delivery into independently reviewable chapters. `PROGRESS.md` is the resume point, and `REVIEWS.md` contains the review history. `README.md` contains exercised CH02 runtime/development commands and is expanded as later chapters are delivered.

Confirmed review policy: stop after each chapter so the user can steer (selected 2026-10-03). The user can later choose continuous development instead. A review checkpoint is an intentional development boundary, not a technical blocker. Do not ask for confirmation repeatedly within a chapter for routine reversible implementation choices.

Every chapter includes relevant tests and a usable slice where applicable. Final verification is not a substitute for testing earlier security or business-logic changes. Do not mark a chapter complete just because its files exist.

## Chapter Map

| Chapter | Focus | Depends On | Main Result |
| --- | --- | --- | --- |
| CH01 | Product specification and development process | None | Reviewed PRD, chapters, progress ledger, review process |
| CH02 | Docker Compose and project foundation | CH01 | Containers build; React shell, API health, DB migrations, development commands work |
| CH03 | Signup, login, sessions, recovery | CH02 | Working account flows and authentication UI |
| CH04 | Organizations, teams, roles, organization admin | CH03 | Tenant isolation and usable member/team administration |
| CH05 | Objectives, periods, owners, key results | CH04 | Usable OKR CRUD, metrics, scoring, lifecycle, and conflict handling |
| CH06 | Multiple parents, dependencies, graph views | CH05 | Validated DAG relationships, child rollups, blocker behavior, graphs |
| CH07 | Check-ins, comments, history, notifications | CH06 | Traceable collaboration and progress history |
| CH08 | Complete professional React frontend | CH03-CH07 | Cohesive dashboard, explorer, detail views, responsive/accessibility polish |
| CH09 | Platform admin and production operations | CH04, CH07, CH08 | Platform controls, production settings, operational runbook |
| CH10 | Integrated acceptance and release review | CH01-CH09 | Verified complete application and release evidence |

## CH01: Product and Process

Deliverables:

- `PRD.md`: agreed product, permissions, domain rules, workflows, architecture, operations, and success criteria.
- This chapter map, plus `PROGRESS.md`, `REVIEWS.md`, and repository instructions in `AGENTS.md`.
- Explicit distinction between implemented behavior, unverified scaffolding, and future requirements.

Acceptance: every requested feature maps to a requirement and a chapter; previous product decisions are retained; a new engineer can identify the next task and review policy without relying on chat history.

Review: scope, database choice, chapter order, permissions, scoring rules, and review cadence. No application runtime is claimed at this checkpoint.

## CH02: Container and Project Foundation

Deliverables:

- Npm workspaces, shared validation/types, API/web build pipelines, locked dependency versions, and TypeScript checking.
- `docker-compose.yml` for web, API, PostgreSQL, migrations, mail worker, optional Mailpit, and test tools. Add a development override with source mounting and hot reload; retain production-style base images.
- React shell with navigation/loading/error states; API health and readiness routes; shared error format and OpenAPI setup.
- Prisma schema and committed initial migration, including tenant-aware relationships and domain CHECK constraints where Prisma cannot express them.
- README startup/stop/rebuild, migration, development, and container-only verification commands. PostgreSQL persists in its own volume.

Acceptance: build all images; apply migration to an empty database; access the React shell through the web proxy; obtain successful health/readiness responses; typecheck workspaces; restart without losing a test database record. No host Node installation required.

Review: runnable infrastructure, data model, dependency lock, exposed ports, and startup ergonomics. Initial scaffold from R001 must be validated or corrected here; it is not presumed correct.

## CH03: Authentication and Accounts

Requirements: AUTH-01 through AUTH-04, plus account-facing UI-02/UI-03 states.

Deliverables:

- Signup, login/logout, current-session endpoint, profile/password updates, and protected frontend routes.
- Argon2id hashes, hashed session/action tokens, secure cookie settings, CSRF and origin checks, rate limits, token expiry, and session revocation.
- SMTP verification/recovery, self-hosted trusted-operator reset links, and copied/emailed invitations. CH03 provides an audited host command; CH04 adds organization-admin controls without exposing a global-account credential-reset bypass. Outbox creation is atomic with token creation; CH07 adds worker monitoring/notification features.
- Signup can create an organization or accept an invitation. Organization creation produces an owner membership; no automatic platform-admin privilege.

Acceptance: browser signup/login/logout; wrong-password and duplicate-email handling; expired/reused token rejection; CSRF rejection; email-mode verification; no-SMTP recovery path; old sessions unusable after password reset/change. Do not reveal whether an email exists through password-recovery responses.

Review: onboarding, verification requirements, password policy, and account security behavior. Invitation creation and full member admin arrive in CH04.

## CH04: Organizations and Organization Administration

Requirements: ORG-01 through ORG-03, role matrix, NOTIFY-01 invitation foundation.

Deliverables:

- Organization creation/switching, timezone/settings, active membership checks, and tenant-scoped endpoint guards.
- Reuse CH03 session checks and requireVerifiedEmail for SMTP content mutations. Do not expose trusted-host reset issuance to a tenant admin without checking global-account privilege/other-organization implications.
- Owner/admin/manager/member/viewer permission helpers shared across API paths, with active assignment checks.
- Member list, search, role changes, copied/emailed invitations and revocation, membership activation, owner transfer, and admin audit events. Copied global-account reset links retain the trusted host-operator command; they are not an ordinary tenant-admin HTTP capability.
- Teams, team membership, designated managers, and team-management UI. Managers administer their designated teams, not the organization membership directory.
- Last-owner and ownership-reassignment safeguards. Until objectives exist, test lead reassignment against fixtures; integrate actual objective constraints in CH05.
- Organization/member/team version checks prevent stale administrative changes. Owners control owner-role changes; only organization admins appoint/remove designated team managers.

Acceptance: a user can switch between two organizations; wrong-tenant read/write and assignment attempts fail; viewers cannot mutate content; managers cannot administer unrelated teams; the last owner cannot be suspended or demoted; invitations are single-use and bound to email.

Review: admin usability, role boundaries, organization isolation, and offboarding rules.

## CH05: Core OKRs and Scoring

Requirements: OKR-01 through OKR-06, UI-01/UI-02 initial explorer and details.

Deliverables:

- Quarterly periods and custom date ranges, objective list/detail/create/edit, company/team/personal scope, descriptions, and ownership assignments.
- Numeric increase/decrease and binary key results with optional accountable owner, positive weights, normalized scores, and metric editing.
- Key-result scoring; child mode activation/linking and rollups are delivered in CH06. The earlier R005 draft restriction is superseded by R006 after verification.
- Draft/active/completed/cancelled lifecycle, archive/reopen, closing notes/final score, optimistic version checks, and transactional audit entries.
- Owner transfer before deactivation; inactive users/viewers cannot be assigned editing roles. Personal/team creation permissions are enforced server-side.
- Reuse CH04 active-tenant/assignment guards and organization transaction locks for assignment writes, so assignment creation cannot race offboarding. Reassignment must release historical ownership/assignment references before suspension or viewer demotion.
- Metric changes require both metric and objective versions, advance both, and serialize with lifecycle snapshots. Closed/archived ownership changes leave numeric history and frozen scores intact. Planning-period versions reject stale changes; used dates/deletion remain guarded.
- Initial explorer includes URL-persisted search, period/team/lead/state/archive/date-overlap filters, sorting and pagination; overview uses unique objective counts and active-only averages/overdue dates in organization timezone. Physical objective removal is represented by archive, preserving history.

Acceptance: create quarterly and custom-date objectives; assign people; update increasing/decreasing/binary metrics; verify weighted scores, zero-input score, and score clamping; reject invalid dates/targets; reject stale edits; test lifecycle snapshots and offboarding.

Review: objective editing, measurable outcomes, ownership, scoring formulas, and lifecycle semantics.

## CH06: Alignment and Dependencies

Requirements: GRAPH-01 through GRAPH-05 and OKR-05 child rollup.

Deliverables:

- Alignment links supporting multiple parents, separate prerequisites, and parent-specific positive contribution weights.
- Transactionally serialized graph edits, duplicate/self/cross-tenant/cycle rejection, and permission checks at both alignment endpoints.
- Weighted direct-child scoring and ancestor recalculation, score-mode switching, and unique objective totals.
- Unresolved-prerequisite warnings, explicit completion override notes, cross-period alignment indicators, and relation editing from objective detail.
- React Flow/Dagre alignment and dependency views, filter-aware connected-node indicators, fit/zoom, lead avatars and team/scope icons, and an accessible list alternative. Objective selection opens a responsive right-side panel with existing permission-aware detail/edit workflows, conflict recovery and keyboard focus restoration. Destructive controls are styled, aligned and confirmed. Both graphs flow left to right without arrow labels; filters collapse while preserving applied values. A selected live objective editor can create an aligned child through an atomic API operation with version/permission checks, graph refresh and conflict recovery.

Acceptance: a child aligns to two parents; unequal weights calculate correctly; shared children are not duplicated in organization totals; a concurrent opposing-link test cannot create a cycle; dependency warnings do not change numeric progress; completing with unresolved prerequisites requires a note; graphs work on desktop and mobile with horizontal direction, collapsible filters and panel child creation; denied/stale/audit-failed creation leaves no child or alignment.

Review: graph semantics, multi-parent presentation, blocker workflow, and rollup interpretation.

## CH07: Collaboration and Traceability

Requirements: LOG-01, LOG-02, NOTIFY-01, AUTH-03 reliable mail delivery.

Deliverables:

- Immutable check-ins combining notes, health, metric changes, and progress snapshots in one transaction.
- Comments, chronological objective history, organization activity feed, and progress-history visualization.
- In-app assignment/comment/check-in notifications, follower preferences, unread/read states, and notification links that respect current access.
- Email worker with bounded retries/backoff, safe logging, sent status, and operational failure visibility. Never duplicate mail-worker claims across concurrent workers.

R007 implementation decisions: comments stay append-only and are allowed on archived/closed work for active non-viewers. Key-result owners can check in with own-metric updates; objective editors/contributors can change every metric. Per-objective mute persists independently of assignments. Organization activity includes only objective events; administrative history remains restricted. Progress visualization uses the current page of immutable check-in snapshots. Global mail diagnostics/retry use trusted-host commands until platform administration exists. Account locks use FOR NO KEY UPDATE to serialize non-key writes while permitting notification foreign-key references to other actors waiting on tenant serialization.

Acceptance: contributors can update progress but cannot change structural ownership/links; metric/check-in/audit changes roll back together on failure; followers receive notifications without notifying the actor; viewers cannot comment; history survives archival and user suspension; outbox retries and single-use links work with Mailpit.

Review: check-in workflow, activity readability, notification usefulness, and audit completeness.

## CH08: Professional Frontend Completion

Requirements: UI-01 through UI-03, GRAPH-05 frontend finish.

Deliverables:

- Cohesive organization navigation, overview, My OKRs, explorer, team views, objective details, graphs, activity, notification center, profile, and organization settings.
- Search, period/team/owner/lifecycle filters, pagination/sorting, overdue/health summaries, and unique-count dashboard aggregates.
- Consistent accessible dialogs/forms, icon tooltips, success/error feedback, conflict recovery, and loading/empty/permission states.
- Responsive desktop/mobile layouts and keyboard-complete core workflows. Use compact typography, restrained white/gray surfaces, teal commands, and distinct status colors.

Acceptance: Playwright workflows against the real API; representative desktop/mobile screenshots; no overlapping text or page overflow; visible graph data; keyboard navigation/focus checks; filters/sorting/pagination return correct server-backed results; refresh/deep links preserve route state.

Review: real workflows, visual consistency, navigation density, and usability. Screenshots are evidence, not a substitute for interaction checks.

R008 delivery (2026-10-09): grouped, scrollable navigation; modal mobile focus handling and route titles/focus; protected path/query/hash recovery through sign-in; lifecycle/health dashboard shortcuts; URL-backed explorer/My objectives health/scope/page-size controls, filter disclosure/reset and result return; team-to-objective/alignment links; keyboard section links in full-page/graph-panel details; member/activity/admin/notification URL state and missing-membership recovery. Existing role, version, graph and collaboration semantics remain unchanged. No schema/API/dependency changes. Docker builds/typechecking, 20 unit/API and 86 PostgreSQL checks pass. Complete browser regressions with zero retries: 72 self-hosted passes plus 2 expected SMTP-only skips, 74 SMTP passes with Mailpit, and a final affected membership-viewport pair. Representative desktop/mobile screenshots were inspected; overflow checks pass. Scope covers verified key workflows, not formal accessibility certification or a large-organization benchmark. R008 is ready for review; CH09 remains next.

R008 layout review follow-up (2026-10-10): all page-level filters collapse, including member search and notification unread filtering, without clearing URL values/results. Graph canvases grow with the viewport and graph help starts collapsed. Graph cards keep 230px width with compact owner/icon rows and no dates/planning periods; other objective cards also omit dates and use icon-only scope. Full titles/dates/team names remain available in accessible labels/tooltips and details. Docker build/typechecking and all 58 distinct affected desktop/mobile browser checks pass across the initial regression and corrected graph checks; final graph layout regression passes 14/14 with no retries. Normal localhost runtime restored; R008 remains ready for review and CH09 is not started.

R008 graph title-row follow-up (2026-10-10): Alignment/prerequisite cards use a pale teal title row with a subtle divider and tight owner/progress spacing. Single-line titles do not reserve a blank second line. Source changes are limited to graph-canvas.tsx/styles.css; Docker build/typechecking and eight existing desktop/mobile graph checks pass with zero retries. Screenshots inspected; separate artifacts preserve the previous evidence. R008 remains ready for review.

R008 graph sizing/progress follow-up (2026-10-10): graph cards now use 253px width and 99px base height, making them 10% wider/shorter; warning heights are reduced proportionally. Titles clip after one line with full-name tooltip/accessibility/details. At 100% API progress the card gains a subtle green tint, which clears below 100%, independently of lifecycle. Graph source/styles and the existing card scenario were updated. Docker build/typechecking and eight affected real-API desktop/mobile graph checks pass with zero retries, including live 99 → 100 → 99 color changes. R008 remains ready for review; no CH09 work started.

R008 signup startup flag follow-up (2026-10-10): DISABLE_SIGNUP defaults to true and gates public account creation in the API and frontend. Session metadata controls the login link/direct signup route without a web rebuild; false re-enables public registration. Existing users and validated invitations remain supported. Startup flag validation and signup rejection/rollback/login/invitation tests pass: 21 unit/API, 88 PostgreSQL, 8 enabled browser passes plus 2 expected SMTP-only skips, and 4 disabled desktop/mobile passes with zero retries. This fulfills the user's startup-flag request; platform bootstrap/global administration and full production operations remain CH09.

R008 three-row graph cards follow-up (2026-10-10): Alignment/prerequisite cards now fit three rows at 253px × 80px: tinted clipped title, lead/scope icon, right-aligned progress/lifecycle. Warnings share the last row as accessible tooltip icons and add no height. Selection does not alter dimensions. Docker build/typechecking and eight affected real-API desktop/mobile checks pass with zero retries, including both warning icons and the existing live green tint/details/panel behavior. Screenshots inspected and normal default-disabled signup runtime restored. R008 remains ready for review; CH09 is not started.

R008 graph indicators/branches follow-up (2026-10-10): explicit completion remains required as confirmed by the user; 100% active graph cards show Achieved and actual completed objectives show Completed. Health icons, full-graph main-objective stars, solid Alignment lines without arrows, keyboard-operable child collapse/expand with shared-parent semantics and stable generated team colors are delivered. API graph root metadata remains tenant scoped. Cards retain three rows at 253px × 80px. Build/typechecking, 21 unit/API and 88 PostgreSQL checks pass; all 62 distinct affected desktop/mobile browser checks pass across the initial regression and final corrected 14-check graph run with zero retries. Screenshots inspected; normal runtime restored. R008 remains ready for review; CH09 is not started.

R008 stable positions/health circles follow-up (2026-10-10): requested main-objective stars removed; health indicators use green/amber/red circles with full labels/tooltips. Both graph views calculate card positions from the complete matching graph; child collapse/expand changes visibility without reflow or viewport/zoom changes. The visibility toolbar reserves its height. Shared/nested/persisted collapse, existing status/team colors and three-row cards remain delivered. Docker build/typechecking and a final clean 16/16 real-API desktop/mobile affected run pass with zero retries. Canvas-relative geometry assertions exclude document scrolling. Screenshots inspected; normal runtime restored. R008 remains ready for review; CH09 is not started.

## CH09: Platform Administration and Operations

Requirements: platform role rules, ORG-03, PRD sections 5-7.

Deliverables:

- Explicit bootstrap command, protected platform-admin routes/UI, global account/organization activation, and audited actions.
- Platform admins cannot implicitly read organization objectives. Global suspension cannot orphan an organization or deactivate an unreassigned lead.
- Production environment validation, secret handling, HTTPS/cookie guidance, database persistence, readiness, log hygiene, migration/upgrade sequence, and outbox diagnostics.
- Tested README runbook for admin onboarding, SMTP/self-hosted configuration, database dump/restore, upgrades, and troubleshooting. Optional synthetic seed is explicit and guarded against production use.

Acceptance: bootstrap/promote an administrator explicitly; ordinary users cannot access platform controls; administrative actions are audited; production rejects unsafe configuration; backup restores into an isolated database with matching representative data; SMTP and self-hosted instructions reflect actual commands.

Review: operational simplicity, bootstrap privileges, platform boundaries, restore evidence, and documentation accuracy.

R009 delivery (2026-10-10): explicit create/promote administrator command (password stdin, no tenant membership, idempotent promotion), protected searchable platform account/organization activation and global history, version/reason/actor audits and global owner/offboarding/session safeguards. Platform access never bypasses tenant membership. Production preflight/API/worker guards, loopback production web overlay, database-driven readiness, rotating query-free logs and tested onboarding/SMTP/self-hosted/upgrade/backup runbooks are delivered. Eight migrations applied. Builds/typechecking, 24 unit/API and 99 PostgreSQL checks pass; affected desktop/mobile acceptance passes 16 self-hosted (4 expected mode skips), 10 SMTP with real Mailpit, and 4 disabled-signup checks, all zero retries. The isolated restore matches 20 tables/30 rows; production unsafe startup and live log hygiene pass. Representative screenshots inspected and fixtures/isolated databases cleaned. Normal localhost/self-hosted/default-disabled-signup runtime restored. No external TLS deployment, monitoring service or automatic retention policy is claimed. R009 is ready for review; CH10 remains next.

## CH10: Integrated Verification and Release

Deliverables:

- Complete requirement-to-test matrix, unit/integration/browser suites, and a concise release report with actual command results.
- Clean-container startup and migration verification, desktop/mobile/browser checks, tenancy/auth/permission regression coverage, and persistence/backup evidence.
- Resolve release-blocking defects; record remaining limitations explicitly; synchronize PRD/README/chapter status with delivered behavior.
- Leave a working local server and provide the actual URL and account/onboarding instructions. Never claim external production deployment unless performed and requested.

Acceptance: all earlier chapter checks pass, no unresolved release-blocking issues, no mocked first-party API in end-to-end tests, and the user can exercise the complete product through Docker Compose.

Review: end-to-end demonstration, release evidence, known limitations, and readiness for deployment.

R010 delivery (2026-10-10): complete numbered/operational requirement matrix and release report; separate Compose acceptance project with a fresh volume and preserved normal runtime. Docker builds/typechecking and schema/Compose validation pass. Backend: 24 unit/API + 99 PostgreSQL, zero skips. Complete zero-retry real-API desktop/mobile browser runs: 90 self-hosted passes/four expected skips, 92 SMTP passes/two expected skips, plus four disabled-signup/login/invitation checks in each email mode. Combined distinct coverage: 217 checks. Eight clean migrations, no pending rerun, database-outage readiness/liveness, restart persistence, production startup guards, actual isolated administrator CLI and safe logs pass. Documented dump/restore matches all 20 tables/30 rows including eight migrations and correct relationship direction. Fixed production verification exit reporting, restore fixture orientation and browser waits for actual filter/sign-out/recovery state; no application API/UI/schema/dependency change. Temporary project/volume/dump removed; normal localhost:8080 remains healthy with self-hosted email/default-disabled signup and zero fixtures. RELEASE/REQUIREMENT_TEST_MATRIX retain evidence and known deployment/performance/accessibility/retention limits. R010 is ready for review; CH10 is the final planned chapter, with no automatic external deployment or next chapter.

## Pause, Resume, and Revisions

R018 additional scope (2026-10-29): investigation of the reported parent-line issue found that the named objective is cancelled, so existing API lifecycle rules prohibit reattachment. Graph lines now remain selectable for an explanation of lifecycle/archive/permission locks, with a dismissible in-canvas notice and **Open objective**. Reopening remains explicit; tested reopening through the panel enables parent dragging with retained link identity/weight. Docker builds/compilation and all 86 objective/graph desktop/mobile checks pass with zero retries. Normal frontend updated, real objective/parent unchanged, isolated stack removed. No API/schema/dependency change. Stop for R018 review.

R017 additional scope (2026-10-29): the user requested correction of overlapping objectives after moving alignment-tree cards. Both graph views now resolve crowded drops to the nearest free space with a 32px gap, preserve stationary cards and free drops, and repair saved positions on restoration or changed graph data. Collapsed descendants reserve their space; corrections persist in the existing personal tab layout. Docker web/browser builds and shared/API/web compilation pass; all 82 objective/graph real-API desktop/mobile checks pass with zero retries. Localhost uses the tested frontend; isolated fixtures and services are removed. No API/schema/dependency changes. Stop for R017 review.

R016 additional scope (2026-10-26): the user requested visible connection points on unconnected objectives, Delete-key relationship removal and draggable objective cards. Always-visible 14px points retain disabled styling and API permissions; card movement persists as a browser-tab layout preference per membership/organization/graph type, with reset to automatic layout. Delete selects the existing versioned removal confirmation and focuses its confirm button; objective cards/form fields remain protected. Docker web/browser builds and shared/API/web compilation pass; 46 affected real-API desktop/mobile checks pass, zero retries. Normal frontend updated, API/worker/database preserved, isolated fixtures/project removed, and ten migrations/single-parent constraint remain. No API/schema/dependency change; backend/SMTP/deployment checks were not repeated. Stop for R016 review.

R015 additional scope (2026-10-26): the user requested drag-created graph lines, dependency-line removal, and a maximum of one alignment parent. The single-parent decision supersedes earlier shared-parent behavior while preserving multiple prerequisites. New card-point dragging in either direction and keyboard/touch creation controls use the real API. Selected alignment/dependency lines offer confirmed removal. API checks and migration 10's partial unique index protect cardinality, versions, permissions and concurrency. The migration refuses unresolved legacy parents; the user explicitly selected “test” as the surviving parent of “2nd”, and only the “SECOND” alignment was removed with a guarded, audited trusted-host operation before migration. Builds, all 29 unit/API + 124 PostgreSQL checks and 40 affected desktop/mobile browser checks pass; a final screenshot-readiness pair also passes. Normal localhost is updated and healthy, with ten migrations and disabled public signup. Stop for R015 review. External Slack/deployment acceptance remains unchanged.

R013 additional scope (2026-10-19): the user requested detaching an objective from its alignment parent and attaching it to another objective. Explicit attach/detach/change-parent controls in the Alignment details panel and shared full-page details and an atomic versioned parent replacement API are delivered. Multiple parents, existing relationship permissions, lifecycle locks, weights and graph layout decisions are preserved. Docker builds/compilation, 29 unit/API + 115 PostgreSQL checks and 22 real-API desktop/mobile browser checks pass, zero failures/skips/retries. The localhost runtime is updated and isolated fixtures/project removed. Stop for R013 review; prior R012/R011 acceptance and external setup are not inferred.

R012 additional scope (2026-10-10): the user requested Slack notifications/objective updates and confirmed outbound messages. Organization-admin incoming-webhook configuration, encrypted credentials, event-time messages queued with objective audits, a bounded/rate-aware delivery worker, status/test/retry/pause/disconnect controls and organization-aware objective links are delivered. Builds, all 29 unit/API and 107 PostgreSQL checks pass; the final affected Slack rerun passes 13 checks after extending progress-only filtering. All 70 distinct affected real-API desktop/mobile scenarios pass across the initial regression and final eight-check Slack run, with zero retries. Seven deployment-runtime tests verify retained keys/credentials and refusals. No real Slack request or AWS apply was performed. Nine migrations are installed in the normal localhost runtime. Stop for R012 review; supplying a channel webhook and verifying live delivery are operator setup.

R011 additional scope (2026-10-10): the user requested deployment scripts for one EC2 and selected a dedicated VPC. Terraform, protected release packaging, cloud-init/Compose/Caddy/systemd startup, persistent encrypted storage, optional host-fetched SMTP secrets and an administrator/maintenance runbook are delivered. Mocked Terraform and runtime tests, packaged builds and isolated production HTTPS/persistence checks provide local evidence. No AWS resources, real account promotion or public certificate were created. This is an explicit addition after CH10, not an automatically started chapter or authorization to apply a cloud plan. Stop for R011 review; actual AWS configuration/apply and cloud verification remain operator work.

- `pause`: stop starting new work; finish or cancel the current atomic operation safely; record modified files, tests/results, running services, unresolved decisions, and exact next action in PROGRESS. Do not discard changes or stop a user-needed server without reason.
- `continue`: read AGENTS, PRD, this document, PROGRESS, and the latest review. Inspect actual files before resuming. Complete the currently authorized chapter, including fixes requested in its review.
- `continue CHxx`: start that chapter only if prerequisites are complete. If they are not, state the gap and resume the necessary prerequisite rather than marking skipped work done.
- `review Rxxx`: inspect that revision's real changes and evidence. Lead with bugs/risks and requirement mismatches. Record findings without claiming tests were run unless they were.
- `revise ...`: update the affected requirement and chapter, record the reason in the next revision, and rerun affected verification before completing dependent work.

Review statuses: ready for review, accepted, accepted with changes, rework requested, superseded. Chapter statuses: not started, scaffold only, in progress, ready for review, complete, paused. Ready for review means chapter deliverables were verified; complete additionally means the requested review gate was satisfied. Review decisions are recorded only when actually given by the user.

At each boundary, report revision ID, behavior/documents changed, verification evidence, limitations, and the next chapter. In chapter-review mode, stop there until the user continues or requests changes. A simple `continue` at a ready-for-review boundary authorizes the next chapter unless outstanding review changes first need resolution.
