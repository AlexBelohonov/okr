# Revision and Review History

Review records are append-only once a later revision exists. Add corrections or steering to a new revision, and link the superseded revision rather than erasing history. Revision IDs do not imply Git commits or deployments.

## R001: Product Specification and Chapter-Based Delivery

Date: 2026-10-03 | Chapter: CH01 | Status: ready for review

### Changes

- Created PRD with product scope, requirements, role matrix, OKR calculations, multi-parent alignment, prerequisites, collaboration, account modes, and operating model.
- Divided development into ten chapters with dependencies, deliverables, acceptance criteria, and review topics.
- Added progress/resume tracking and instructions for later engineers/agents.
- Began unverified container/package/domain scaffolding before the user requested chapter checkpoints. These files are explicitly CH02 scaffold, not CH01 delivery or verified functionality.

### Evidence

- Read workspace and environment; initial project directory was empty.
- Confirmed Docker engine 29.1.3 and Docker Compose v5.0.0-desktop.1. Host Node/npm unavailable on PATH.
- Documentation checks passed: all five project documents exist and all ten chapter sections are present; requirement-to-chapter coverage inspected. Eight scaffold JSON manifests parse successfully. No application build, migration, or functional tests have been run.

### Decisions Retained

PostgreSQL; multi-organization memberships; fixed roles/teams; all-member visibility; multiple alignment parents; separate prerequisite graph; configurable child scoring; lead/co-owner/contributor/follower assignments; both account-delivery modes; blocker override notes.

### Review Topics

- Product coverage and exclusions.
- Chapter order and review cadence.
- Role and assignment rights.
- Multiple-parent scoring and completion behavior.
- Operational defaults and optional email delivery.

### Review Decision

Product/chapter deliverables pending user review; no chapter acceptance has been inferred or recorded yet. The user explicitly selected "Stop after each chapter for your review" on 2026-10-03. CH02 will not start until the user continues or requests R001 changes.

### Next Revision

R002 will implement and verify CH02 container/project foundation, or first address requested changes to R001.

## R002: Runnable Docker Compose Foundation

Date: 2026-10-03 | Chapter: CH02 | Status: ready for review

### Previous Review Boundary

The user said continue after R001. Under the agreed process this authorized CH02; no R001 revisions were requested. The confirmed policy remains stop after each chapter.

### Changes

- Made Docker Compose runnable with Node 24, PostgreSQL 18, Nginx, migration dependency ordering, health checks, persistent storage, containerized tooling, and optional worker/Mailpit.
- Added committed dependency lockfile, npm ci builds, container-only bootstrap commands, and a source-mounted API/Vite development override.
- Validated the Prisma schema, generated the initial migration, added domain CHECK constraints, and corrected composite tenant references for nullable owners/teams/periods, comments, check-ins, and notifications.
- Added shared response/error contracts; API health/readiness, sanitized errors, OpenAPI documentation, graceful shutdown, and an opt-in heartbeat-only worker.
- Added professional React overview/settings shell with responsive navigation, actual service status, empty states, deep-link recovery, and offline/retry handling. No fake objectives, sample metrics, or operational admin controls are shown.
- Added meaningful API/database/browser checks, an isolated restart-persistence probe, and README commands for actual delivered behavior.

### Corrections Found During Verification

- Corrected outdated/transitive package versions; current npm audit reports zero vulnerabilities. Prisma's config dependency uses a scoped deepmerge-ts 8 override; unused mail dependencies are deferred to CH03.
- Fixed Swagger CSP upgrading internal HTTP assets to HTTPS; secure-cookie mode retains the HTTPS upgrade directive and is covered by a regression test.
- Allowed only the explicit Docker web hostname in Vite's development host check; did not disable host checking globally.
- Fixed cached readiness data leaving stale Online/Connected values visible after connection failure; browser tests exercise failure and recovery through settings.

### Evidence

- Workspace typecheck/build and Prisma validation/client generation: pass.
- Initial empty-database migration plus domain constraints: pass; repeat migration startup succeeds.
- API tests: 6 pass. Real PostgreSQL integration tests: 10 pass. All 8 browser tests pass on both the final built-image runtime and the source-mounted development runtime. Final host check confirmed the built React frontend is left running and readiness returns connected; database/API are healthy and migration exits with code 0.
- Database record survived container restart; isolated probe removed afterward. Integration fixtures roll back.
- Desktop/mobile screenshots generated and inspected; no page overflow, incoherent overlap, or blank shell found.
- Optional Mailpit inbox responds on loopback port 8025; worker emits worker_ready with deliveryEnabled=false.

### Review Topics

- Docker-only startup and development ergonomics.
- Initial data model, tenant-aware foreign keys, and domain constraints.
- React shell/navigation density and connection/error states.
- Clear distinction between this foundation and later signup/admin/OKR features.

### Limitations and Running State

Local application: http://localhost:8080. Documentation: http://localhost:8080/api/docs/. Optional Mailpit: http://localhost:8025. Database/API/web and optional worker/inbox remain running for review; migration job exits normally.

No signup/login, member administration, objective CRUD, graphs, email delivery, platform admin bootstrap, seed, or production deployment is claimed implemented. The worker is intentionally heartbeat-only and opt-in. No Git commits/tags were created.

### Review Decision and Next Revision

Pending user review. Verification is complete; development is stopped at the agreed boundary. R003 starts CH03 account workflows only after the user continues or requests R002 changes.

## R003: Accounts, Protected Workspace, and Delivery Modes

Date: 2026-10-03 | Chapter: CH03 | Status: ready for review

### Previous Review Boundary

The user said next after R002, authorizing CH03 under the agreed stop-after-each-chapter process. No R002 rework was requested. Earlier review records remain unchanged as historical checkpoints.

### Changes

- Signup creates an organization owner without platform-admin privilege, or joins a bound invitation. Existing accounts can accept invitations without role escalation/reactivation.
- Argon2id passwords; hashed session/action tokens; seven-day HttpOnly/SameSite sessions; secure production configuration; origin/JSON/CSRF checks; client-IP throttle checks and proxy forwarding protection.
- Login/logout, session/profile, password change/reset with all-session revocation; account-row locks and atomic single-use token consumption.
- SMTP verification/recovery with atomic token/outbox creation; self-hosted trusted-operator reset/invite links with audit records. No ordinary tenant-admin global-password-reset endpoint is exposed.
- SMTP worker with exclusive claims, bounded retries/backoff, sanitized errors, stable message IDs, delivered-payload scrubbing and graceful shutdown. Production SMTP requires TLS.
- React account screens, protected workspace routing, name/password settings, email status/resend and responsive forms; real organization label without pretending OKR/admin workflows exist.
- Account migration/indexes, dependency lock update, dedicated browser-test origin override, security/integration/E2E coverage, updated PRD/runbook and exact resume point.

### Evidence

- Unit/API: 10 pass. Real PostgreSQL: 27 pass, including secure-cookie flags, throttles, concurrent reset consumption, session revocation, invitation rollback/expiry, canonical email constraints, and the trusted-operator command.
- Source-mounted browser: self-hosted 14 pass plus 2 intentional SMTP-only skips; SMTP all 16 pass against real API/PostgreSQL/Mailpit, without first-party mocks.
- Prisma migration/client generation and workspace typecheck/build pass. Dependency audit reports zero vulnerabilities.
- Desktop/mobile login/signup/account screenshots viewed; workflow assertions confirm no page overflow or JavaScript errors.
- Final built-image acceptance: all 16 SMTP checks pass; 14 self-hosted checks pass with 2 intentional SMTP-only skips. Final built tooling reruns pass all 10 unit/API and 27 PostgreSQL tests: 53 distinct tests, excluding repeated runs.
- Normal localhost base stack restored; database/API healthy, built Nginx frontend present, migration exits 0 with no pending migrations. Host-origin/CSRF smoke checks pass (valid origin reaches validation; forged origin rejected). All Compose variants validate.
- Scoped fixture check reports zero test users/outbox rows; test-owned organizations are removed by fixture cleanup. Only detached review services remain, no required command/test sessions. Mailpit can retain synthetic messages with deleted/invalid action records.

### Corrections During Verification

Corrected proxy-trust typing, password visibility control labels, timezone test locator, stale action-link success state, and the test expectation for return-to-settings after reauthentication. Earlier failed runs were superseded by successful source-mounted acceptance; no failure was hidden by skipping its workflow.

### Review Topics

Onboarding/password policy, SMTP versus self-hosted recovery, invitation acceptance, profile settings, and trusted host-operator link ergonomics. Review the explicit sensitivity of outbox/inbox links and the global-account implications of copied reset links.

### Limits and Next Revision

No organization switcher/member/team admin, OKR CRUD, graphs, collaboration, platform bootstrap or production deployment is claimed. Mail delivery is at-least-once across SMTP acceptance/process crash; five failed attempts stop retries, and maintenance/retry UI arrives later. Account suspension is respected; admin suspension controls arrive later.

R004 will implement CH04 organization/team/member administration only after R003 review/continuation. The chapter boundary remains mandatory.

### Review Decision and Running State

Verification is complete; pending user review. Development is stopped at R003. Try http://localhost:8080/signup, then account settings. Default runtime is self-hosted with normal security throttles; optional worker/inbox remain running. SMTP operation and sensitive copied-link instructions are in README. No external deployment or Git commits/tags were created.

## R004: Organizations, Members, Teams, and Administrative History

Date: 2026-10-04 | Chapter: CH04 | Status: ready for review

### Previous Review Boundary

The user said continue after R003, authorizing CH04 under the stop-after-each-chapter policy. No R003 rework was requested. Earlier records remain historical; no additional explicit acceptance decision was inferred.

### Changes

- Organization creation with owner membership, settings/timezone, account-scoped browser-tab switching with stable membership order and reload persistence. Every organization API path checks current active tenant membership independently.
- Owner/admin directory search/pagination, roles/activation, copied/optionally emailed invitations, revocation/status, and ownership transfer. Invitations cannot grant owner status or reactivate/promote existing memberships.
- Owner-role changes require an owner. Transfer promotes an active recipient and makes the initiator an admin while preserving other owners. Serialized changes count only active owner memberships with active global accounts, preventing concurrent last-owner removal.
- Teams/rosters and designated managers. Managers edit names/ordinary rosters only for designated teams; owners/admins create/delete teams and appoint/remove managers. Inactive accounts/members cannot receive new assignments; viewers cannot receive editing assignments.
- Membership suspension/viewer demotion requires lead/co-owner/contributor/key-result ownership reassignment, including archived work. Suspension or demotion below manager/admin/owner clears designations atomically and preserves authorship/other-organization access. Teams referenced by objectives cannot be deleted.
- Versioned organization/member/team writes, transactional actor-attributed audit events, and paginated owner/admin history. Shared live-session/verification/Origin/CSRF guards apply to each organization mutation. Account locks precede organization locks; trusted-operator multi-account resets lock accounts in stable order and recheck after locking.
- Responsive React administration, explicit loading/error/permission/conflict/reload states, real browser/API/database tests, additive fourth migration, updated PRD/development/runbook/checkpoint. Copied global reset links remain trusted host-operator commands; no tenant-admin reset bypass was added.

### Evidence

- Workspace typecheck/build, Prisma validation/client generation and Docker API/web/tools/browser builds pass. Fourth additive migration applies to existing PostgreSQL; final startup exits 0/no pending migrations.
- Unit/API: 10 pass. PostgreSQL integration: 42 pass (15 new CH04 tests plus 27 prior checks). A final built-tooling rerun after the operator lock-order correction passes all 42.
- New desktop/mobile administration acceptance: all 10 pass. Source-mounted self-hosted full regression: 24 pass, 2 intentional SMTP-only skips.
- Built-image SMTP full browser regression: all 26 pass, including real Mailpit verification/reset/invitation delivery and matching invitation links. Built-image self-hosted regression: 24 pass, 2 intentional SMTP-only skips. Both final browser runs use zero retries; no first-party API is mocked.
- Tests cover foreign tenant resource IDs/assignments, fixed role/escalation boundaries, inactive accounts/organizations, concurrent self-demotions, owner transfer/stale versions, scoped suspension, offboarding fixtures, manager revocation, team constraints, invitation rotation/revoke/replay/redaction, and audit-failure rollback.
- Desktop/mobile member/team/invitation screenshots inspected; keyboard switching/reload, no horizontal overflow, conflict feedback and real admin workflows pass. Fixed clipped skip-link behavior removes a screenshot overlay artifact.
- Base/development/test Compose configurations validate. Normal-origin smoke confirms built frontend, connected database, self-hosted mode, valid Origin/CSRF reaching validation (400), and forged Origin rejection (403).
- Scoped fixture check reports zero test users/outbox rows; scoped cleanup deletes test-owned organizations. No command/test sessions remain. Total distinct tests: 78; repeated mode/runtime runs are not additional tests.

### Corrections During Verification

Initial integration rejected long valid email searches; the search bound now matches the email contract. Browser testing found unstable membership ordering, a stale-write fixture that raced initial loading, and a roster assertion that included pending picker text. Stable ordering and committed-state assertions resolve these issues. Code review also corrected the trusted-operator reset lock order to avoid waiting for an account lock while holding an organization lock; affected integration tests were rerun. Earlier failures were superseded by successful checks without workflow skips or final browser retries.

### Review Topics

Organization switching/settings, member search/roles/activation, owner-only role changes and transfer, invitation creation/revocation, designated-manager boundaries, admin history, and mobile administration. Review the conservative offboarding rule requiring reassignment of all editing references, including archived objectives; CH05 provides those editing screens.

### Limits and Next Revision

Periods/objective CRUD/scoring/reassignment remain CH05; child scoring/graphs CH06; general collaboration/notifications CH07; platform bootstrap/global activation and production operations CH09. Offboarding/team objective-reference checks use database fixtures until CH05. Global account reset issuance still requires trusted infrastructure access. Invitation Closed status combines acceptance and invalidation/revocation; administrative audits distinguish actions. No dependency changes, Git repository/commits/tags, or external deployment were created.

R005 starts CH05 only after review/continuation. The chapter boundary remains mandatory.

### Review Decision and Running State

Verification is complete; pending user review. Development is stopped at R004. Open http://localhost:8080/signup or /login, then Organization, Members, Teams, and Administration history. Base built-image runtime is restored with localhost origin, self-hosted delivery, and standard throttles. Database/API/Mailpit are healthy; Nginx web and optional worker remain running. Migration exits 0 with four applied migrations; worker reports deliveryEnabled=false. Mailpit may retain synthetic messages whose accounts/action records have been deleted. See README for copied operator links and SMTP instructions.

## R005: Planning, Objectives, Weighted Outcomes, and Lifecycle

Date: 2026-10-04 | Chapter: CH05 | Status: ready for review

### Previous Review Boundary

The user said continue after R004, authorizing CH05 under the stop-after-each-chapter policy. No R004 rework was requested and no additional explicit acceptance decision was inferred. Prior evidence remains historical.

### Changes

- Calendar-quarter/custom inclusive planning periods, validated dates, versioned admin writes, unique names and guarded used-period date changes/deletion.
- Objective creation/detail/structural editing, company/team/personal permissions, lead/co-owner/contributor/follower assignments and optional metric ownership. Every active tenant member can read objectives; editing assignments require active non-viewer accounts/memberships.
- Numeric increase/decrease and binary outcomes, positive weights, zero-input score and 0-100% clamping. Extreme finite endpoint subtraction and very small positive weights remain accurate. Contributors and metric owners update current values; structure requires objective editor permissions.
- Draft/active/completed/cancelled transitions, required closing notes/frozen final scores, reopen and separate archive. Archive retains history instead of physical objective deletion. Removed key results retain an audit snapshot. Child scoring stays visibly unavailable, zero-scoring draft work until CH06.
- Closed/archived lead/assignment and metric-owner reassignment preserves numeric values/final scores/closing notes, enabling the CH04 historical offboarding guards to be resolved through the delivered UI. Viewers can manage their own following without gaining editing rights.
- URL-persisted explorer filters/sorting/pagination and My objectives with unique totals. Inclusive date-overlap filtering, real overview counts/active-only averages and timezone-aware inclusive overdue dates. Paginated actor-attributed objective history records metric/lifecycle changes and notes.
- Objective/metric versions prevent stale writes; metric mutations require and advance both versions so completion cannot freeze a stale score. Session/account locks precede organization locks, shared with offboarding. Values, assignments, versions, snapshots and audit entries commit atomically.
- Fifth additive migration, responsive React screens, real PostgreSQL/browser fixtures, updated specification/runbook/checkpoint. Nginx now refreshes Docker DNS after API container replacement. Integration files run sequentially to isolate global mail claims; explicit concurrent-request tests remain concurrent.

### Evidence

- Workspace typecheck/build, Prisma validation/client generation, Docker API/web/tools/browser builds and deployed nginx configuration check pass. Fifth migration applies to existing PostgreSQL; final startup exits 0 with no pending migrations.
- Final built tooling: 15 unit/API and 57 PostgreSQL checks pass. New CH05 coverage adds 5 unit and 15 integration tests, including tenant/role/assignment boundaries, period/calendar guards, weighted/extreme/zero scores, unique date filters/active averages, stale/concurrent metrics/completion, snapshot history/reopen/archive, historical reassignment/offboarding race, SMTP/session/Origin/CSRF and audit-failure rollback.
- Built self-hosted browser regression: 38 pass plus 2 intentional SMTP-only skips. Built SMTP regression after proxy correction: all 40 pass, including real Mailpit verification/reset/invitation delivery. Both use zero retries and real first-party APIs. All 14 new CH05 desktop/mobile workflows pass in both modes.
- Objective detail/explorer desktop/mobile screenshots inspected: readable, no content overlap or horizontal page overflow. Assignment form creation, company co-owner editing, increasing/decreasing/binary scoring, frozen completion/reopen/archive, filters/reload, contributor/viewer boundaries, stale edit recovery and historical ownership reassignment followed by suspension pass.
- Base and combined development/test Compose configurations validate. Normal localhost smoke confirms built frontend, connected PostgreSQL, self-hosted mode, valid Origin/CSRF validation response 400 and forged-Origin rejection 403.
- Restoring base services changed the API address from 172.21.0.4 to 172.21.0.3 while the web container identity stayed unchanged; proxy account/readiness requests recovered without restarting Nginx.
- Scoped fixture cleanup reports zero test users/outbox rows and deletes test-owned objectives/audits/organizations. No command/test sessions remain. Total distinct tests: 112; repeated delivery/runtime runs are not extra tests. Locked dependency installation reports zero vulnerabilities.

### Corrections During Verification

PostgreSQL tests caught nested composite-key assignment creation failing at runtime; explicit assignment writes inside the same transaction fix creation/edit/reassignment. Ordinary company co-owner forms retain their existing scope and editing pickers exclude viewers. Browser assertions use actual accessible combobox/checkbox names and membership success text. Weight fractions are normalized to avoid underflow for accepted small positive weights. Concurrent integration files could let the global mail worker claim a sibling SMTP fixture; files now run sequentially while intentional race tests remain concurrent. SMTP switching exposed stale Nginx DNS after API recreation; dynamic resolution fixes it, and a changed-address recovery is verified. Earlier failures were superseded by passing affected checks without final retries or workflow skips.

### Review Topics

Planning periods, objective/assignment forms and scope rules, explorer filters, numeric/binary weights, completion notes/frozen scores, archive/reopen, conflict reload, objective history and historical reassignment before offboarding. Review the intentional child-mode draft restriction and archive-based objective removal.

### Limits and Next Revision

Relationships/child rollups/graphs/blockers remain CH06; general collaboration/activity/notifications CH07; platform bootstrap/global activation and production operations later chapters. No dependency-version changes, Git repository/commits/tags or external deployment were created. Existing user comments were preserved. No required CH05 implementation/test task remains; review acceptance is pending.

R006 starts CH06 only after review/continuation. Reuse organization serialization for graph mutations, rollups and completion; replace child-mode restrictions only when relationship scoring is implemented and verified.

### Review Decision and Running State

Verification is complete; pending user review. Development is stopped at R005. Open http://localhost:8080/signup or /login, then Planning periods, My objectives or All objectives. Base built-image runtime is restored with localhost origin, self-hosted delivery and normal throttles. Database/API/Mailpit are healthy; Nginx web and optional worker remain running. Migration exits 0 with five applied migrations/no pending work; worker reports deliveryEnabled=false. Mailpit may retain synthetic messages whose account/action records were deleted. PROGRESS records the exact CH06 continuation point.

## R005 Review Follow-up: Brief Organization Role Explanations

Date: 2026-10-04 | Scope: requested interface revision | Status: ready for review

The user requested brief explanations of owner/admin and the other roles. Members now has an expandable, keyboard-accessible **What do the roles mean?** guide for all five organization roles. Member and invitation dropdowns show a short description of the current selection, connected through `aria-describedby`; invitation recipients see the same explanation before joining. A shared frontend copy module keeps the text consistent. Manager text describes designated-team scope; member text describes assignment-based editing. API permissions and stored data behavior are unchanged.

Changed files: new `apps/web/src/roles.tsx`; `organizations.tsx`, `accounts.tsx`, `styles.css`; PRD, README and PROGRESS. Workspace typecheck/build and rebuilt web image pass. Six existing desktop/mobile member-role and invitation checks pass with zero retries against the real API. A temporary scoped browser inspection verifies keyboard guide expansion, all five selected-role accessible descriptions, invitation-form/recipient explanations and mobile overflow. Desktop/mobile role-guide screenshots were inspected and are readable. No new permanent tests were added; the earlier full R005 results remain historical evidence.

Review fixtures were cleaned; the fixture script reports zero test users/outbox rows. Normal localhost self-hosted built runtime is restored. No command/test session or required role-help task remains. R005 remains pending user review; CH06 is not authorized by this interface revision. The next action is to address further review requests or start CH06 on user continuation.

## R006: Multiple Alignment Parents, Weighted Rollups, Prerequisites and Graphs

Date: 2026-10-04 | Chapter: CH06 | Status: ready for review

### Previous Review Boundary

The user requested the next chapter after the R005 role-help follow-up, authorizing CH06 under the stop-after-each-chapter policy. No outstanding R005 revision was requested; no additional explicit acceptance decision was inferred. Existing product decisions, role descriptions and user changes were preserved.

### Changes

- Multiple alignment parents and a separate prerequisite DAG, with positive parent-specific contribution weights. Self/duplicate/foreign/cyclic links fail on the API; existing composite foreign keys and database checks protect endpoint tenancy/self/weight invariants.
- Link creation/weight/removal requires both endpoint versions and serialized account-before-organization transactions. Alignment needs live endpoint editors on both sides; dependencies need a live dependent editor and visibility of the prerequisite. Both endpoints retain actor-attributed relationship audits, committed atomically with edge/version changes.
- Iterative weighted direct-child scores and live ancestor calculation, shared-child/unique-total semantics, exclusive key-result versus child modes and zero-input scores. Draft/cancelled/archived children are excluded; completed children and parents retain frozen scores. Reopen returns to live calculation. Related versions advance conservatively so stale parent completion cannot freeze outdated rollups.
- Direct unfinished prerequisites warn while allowing metric work. Completion requires a separate override note when blocked; closing records and immutable audits retain the note and prerequisite-state snapshot. Reopen clears the current assessment while preserving history. Cancelled/archived unfinished prerequisites continue warning.
- Objective relationship search/forms, parent/child/prerequisite/dependent lists, weights/removal, cross-period/date indicators, blocker warnings and override/history text. Viewer/contributor structural restrictions remain enforced server-side.
- Separate React Flow/Dagre graph views with solid teal alignment and dashed amber prerequisite edges, automatic layout, zoom/fit/selection, URL filters, outside-filter connection counts and keyboard/mobile list navigation. Lazy graph loading keeps the main bundle below the build warning threshold.
- Shared URL-filter handling fixes consecutive search-clear/type changes that could restore stale search; the objective explorer uses the same correction.
- Sixth additive migration (override note/incoming-link index); shared contracts/scoring; API/plugin/domain/lifecycle changes; frontend/navigation/styles; five unit, eleven PostgreSQL and eight desktop/mobile browser tests; updated PRD/development/runbook/checkpoint. Full changed-file inventory is in PROGRESS.

### Evidence

- Locked API/web/tools/browser builds, workspace typechecking, Prisma client generation/schema validation pass. Sixth migration applies to the existing database; final startup reports six migrations/no pending work and migration exit 0.
- Final built tooling: all 20 unit/API and 68 PostgreSQL checks pass. New opposing-link and child-update/parent-completion races use distinct actor accounts, exercising organization serialization beyond a single account lock.
- Final built self-hosted browser regression: 46 pass, 2 intentional SMTP-only skips. SMTP regression: all 48 pass, including real Mailpit verification/reset/invitation delivery. Zero retries, real first-party APIs in both modes; all eight new chapter browser workflows pass in both.
- Coverage includes separate/self/duplicate/indirect/cross-tenant/concurrent cycles, endpoint/assignment boundaries, stale weights/removal, multi-parent unequal weights/ancestors/modes, unique totals, lifecycle/archive eligibility/frozen snapshots, completion overrides, audit rollback and session/SMTP/Origin/CSRF/tenant guards.
- Desktop/mobile alignment, prerequisite, relationship and blocker screenshots inspected. Graphs show real nodes/edges; zoom/fit/selection, rapid filter changes/reload, outside-filter indicators, keyboard list navigation, read-only views and no horizontal overflow pass.
- Base and combined development/test Compose configurations validate. Restored normal localhost smoke reports built frontend 200, connected database, self-hosted delivery, valid Origin/CSRF validation response 400 and forged-Origin rejection 403.
- Fixture check reports zero test users/outbox rows; scoped cleanup deletes test-owned links/objectives/audits/organizations/accounts. Detached review services remain; no required command/test sessions remain.
- Total distinct tests: 136; repeated runtime/mode executions are not extra tests. Previous clean-database/persistence evidence remains historical, not repeated as CH06 evidence.

### Corrections During Verification

Corrected shared DB metric typing and test header typing. Initial browser helpers checked control existence before detail loading, used lowercase names for capitalized graph controls, and expected transient feedback from a remounted lifecycle form. Loaded-control waits, actual accessible labels and committed-history assertions resolve those test issues. Browser verification then exposed a real rapid URL-navigation race: clearing search and immediately changing graph type restored old search. Shared pending filter parameters fix graphs and explorer; full affected regression passes. Relation-kind spacing, lazy graph rendering and variable node sizing improve readability. Earlier failures were superseded without final retries or skipped required workflows.

### Review Topics

Multiple parents, per-parent weight interpretation, child eligibility/zero scoring/mode switching, frozen completion versus live reopening, prerequisite warnings and separate override assessment, cross-period indicators, endpoint edit permissions, graph/list filters, mobile readability and conflict reload.

### Limits and Next Revision

Graph snapshots currently load tenant objectives/links into memory and layout all matching nodes; large-organization performance has not been benchmarked. Collaboration/activity/notifications remain CH07; broad frontend completion CH08; platform controls/production operations later chapters. No dependency-version changes, Git commits/tags or external deployment were created. No required CH06 task remains; user review acceptance is pending.

R007 starts CH07 only after review/continuation. Reuse graph-aware score snapshots, related version invalidation and current serialization when implementing atomic check-ins, history and notifications.

### Review Decision and Running State

Verification is complete; pending user review. Development stops at R006. Open http://localhost:8080/signup or /login, then Alignment or an objective's Relationships section. Base built runtime is restored with localhost origin, self-hosted delivery and normal throttles. Database/API/Mailpit are healthy, Nginx web and optional worker remain running; worker deliveryEnabled=false. Six migrations are applied. Mailpit may retain synthetic messages with deleted/invalid actions. PROGRESS records the exact CH07 continuation point.

## R006 Review Follow-up — Graph Identity and Objective Details Panel

Date: 2026-10-04. Scope: requested review revisions to CH06; CH07 remains not started. Ready for user review; acceptance has not been inferred.

### Requested Behavior and Changes

The user requested styled/aligned removal, lead icons on alignment/prerequisite objectives, team icons for team objectives and a clickable objective information/edit panel, with documentation updated.

Relationship removal now uses a bordered destructive button with a trash icon, aligned beside contribution-weight saving; narrow screens wrap controls without stretching or centering removal across the row. Key-result removal uses the same styling/icon. Existing explicit confirmation is preserved.

Both graph types and their list entries show the objective lead's initials avatar/name and a scope icon; team objectives display a team icon/name. Graph node layout accounts for the additional identity lines and long names. Mouse activation and Enter/Space on nodes, plus keyboard-operable list/connected-title buttons, open a right-side dialog. The full-width mobile variant scrolls independently and keeps close controls visible.

The panel shares ObjectiveDetails with the full page, retaining actual API-backed editing, metrics, relationships, ownership, lifecycle, blockers and history. Editors can manage permitted work; contributors update eligible values; viewers read/follow without structural editing. Existing lifecycle locks and stale-version conflict/reload behavior apply. Saves refresh graph data while retaining the selected panel, even when an edit moves the objective outside filters. Escape/close restores the opener, a surviving node/list entry or page heading. A full-page link remains available.

Changed files: new apps/web/src/objective-identity.tsx and objective-panel.tsx; objectives.tsx, relationships.tsx, graph-canvas.tsx and styles.css; tests/e2e/objectives.spec.ts; PRD, DEVELOPMENT, README, PROGRESS and this review ledger. Existing Dockerfile comment and earlier product work preserved. No API/schema/dependency changes.

### Verification

- Docker Compose web/browser builds pass, including shared/API/web typechecking and Prisma client generation. Graph rendering remains lazy.
- Complete self-hosted browser suite against the real first-party API: 48 passed, 2 expected SMTP-only skips, zero retries.
- Final affected run after preserving the full-page progress layout: `docker compose -f docker-compose.yml -f docker-compose.test.yml run --rm --no-deps browser npx playwright test tests/e2e/objectives.spec.ts --retries=0` — all 24 desktop/mobile checks pass.
- New panel checks confirm team/lead icons, keyboard node opening, owner title/current-value persistence through API reads, stale edit conflict/reload, refreshed graph scores, survival after leaving filters, scrolling and fixed header, Escape/close focus restoration, prerequisite-list opening and full-page navigation. Existing viewer/contributor scenarios also exercise the panel.
- Graph zoom/filter/list/removal and full objective/administration regression pass. Desktop/mobile panel viewport screenshots, graph and relationship-removal screenshots inspected in artifacts; no horizontal overflow.
- A test-edit syntax error was corrected before the full regression. Final runs use no retries; no required workflow skips.
- Scoped cleanup reports fixtureUsers=0 and fixtureOutbox=0. Normal localhost frontend returns 200, health reports ok and session metadata confirms self-hosted mode.
- Initial R006's 20 unit/API, 68 PostgreSQL and SMTP browser results remain historical, unchanged by this frontend follow-up. Aggregate distinct coverage is 138, including two new panel checks; repeated runs are not extra tests.

### Review State and Next Action

All requested revisions are complete and verified. Normal built review runtime restored at http://localhost:8080; database/API/Mailpit healthy, web and optional worker running, migration exited 0. No test/build command remains active. Review the Alignment nodes/list, right-side panel and relationship/key-result remove controls. Initial graph-snapshot performance limits remain; avatars use initials because uploads remain outside this release. Stop for R006 review; next continuation begins CH07 as recorded in PROGRESS.

## R006 Review Follow-up 2 — Horizontal Graphs, Collapsible Filters and Child Creation

Date: 2026-10-04. Scope: the user's four requested CH06 review changes; CH07 remains not started. Implementation and verification complete; user review acceptance pending.

### Behavior and Decisions

Removed weight/prerequisite labels from graph arrows. Both views use left-to-right Dagre layout, with right-side sources and left-side targets: parent → child in alignment; prerequisite → dependent in prerequisites. Solid teal/dashed amber arrows and the graph legend retain relationship meaning. Contribution weights still control scoring and remain visible in the connection list/editable in Relationships.

Show/Hide filters collapses the filter area without clearing URL-backed values or changing graph results. The accessible toggle supports keyboard activation and reports expansion; the collapsed summary shows graph type/active-filter count. Unfiltered visits start collapsed; visits with URL parameters start expanded.

The selected objective panel offers Create child objective for live parent editors, from either graph view. It reuses the objective form, defaulting to the parent's dates/planning period and the current member's personal scope/lead. Users can configure normal objective fields, assignments and scope. Cancel creates nothing. A successful save retains the parent panel, shows the new child/relationship and offers opening the child's panel.

The new POST /api/v1/orgs/:orgId/objectives/:id/children accepts objective creation fields plus required parentVersion. The API rechecks live session/tenant, verification, parent edit/live state/version, child creation scope/references and child edit access. Child, assignments, weight-1 parent alignment, endpoint/ancestor versions and actor audits commit together under account-before-organization locks. A newly created child has no links and cannot introduce a cycle. Stale, denied or audit-failed saves leave no orphan. Existing objective creation and relationship finalization are reused.

Changed files: shared index.ts; API objectives routes.ts and relationships.ts; web graph-canvas.tsx, relationships.tsx, objectives.tsx, objective-panel.tsx and styles.css; objectives integration/browser tests; PRD, DEVELOPMENT, README, PROGRESS and this ledger. No migration/dependency changes. Existing Dockerfile comment and prior user/product work preserved; workspace has no Git repository.

### Verification

- Docker API/web/tools/browser builds pass, including shared/API/web TypeScript checks and Prisma client generation.
- `docker compose run --rm --no-deps tools npm test`: 20/20 unit/API checks pass.
- `docker compose run --rm --no-deps tools npm run test:integration`: 74/74 PostgreSQL checks pass. Six new checks cover atomic child/link/audits/rollup/ancestor versions, co-owner versus contributor/viewer rights, allowed child scopes/edit access, foreign parents/references, closed/archived parent locks, distinct-account concurrency/stale requests, audit rollback including assignments and SMTP/Origin/CSRF/tenant guards.
- Full self-hosted browser regression: 52 pass and 2 expected SMTP-only skips, zero retries.
- Full SMTP browser regression: 54/54 pass, zero retries, real API and real Mailpit verification/reset/invitation delivery. Final child scenario also creates from the prerequisite view.
- Four new desktop/mobile browser checks verify horizontal endpoint positions, absent arrow labels, keyboard filter disclosure, preserved search/URL reload, inherited dates/period, cancellation with unchanged totals, child/link persistence, graph refresh/opening, and stale parent recovery without orphan creation. Viewer/contributor scenarios exclude child creation.
- Desktop/mobile graph, panel and child-form screenshots inspected in artifacts. No horizontal overflow; existing removal, identity, focus restoration, lifecycle and organization workflows pass.
- Corrected one test expectation: inactive tenants return the existing resource-hiding 404, not 403. Final complete database run passes.
- Total distinct checks: 148 (20 unit/API + 74 PostgreSQL + 54 browser); repeated runs/modes are not additional checks.
- Scoped fixture check: fixtureUsers=0, fixtureOutbox=0. Normal localhost smoke: frontend 200, health ok, self-hosted mode.

### Review State and Resume

All four requested revisions are complete and verified. Normal built http://localhost:8080 runtime restored; database/API/Mailpit healthy, web and optional self-hosted worker running, migration exited 0. No build/test sessions remain active. Existing six migrations retained; graph snapshot/performance limits remain unchanged. Review arrow direction, filter toggle and Create child objective from a selected node/list entry. Stop for R006 review; next continuation begins CH07 as recorded in PROGRESS.

## R007: Check-ins, Comments, Activity, Progress History and Notifications

Date: 2026-10-07 | Chapter: CH07 | Status: ready for review

### Authorization and Scope

The user requested "next chapter" after both verified R006 follow-ups, authorizing CH07 under the existing stop-after-each-chapter policy. No additional explicit acceptance decision was inferred. Workspace inspection confirmed the existing source/runtime and no Git repository. Previous product choices, role descriptions, graph/panel/child behavior and the user's Dockerfile comment were preserved.

### Delivered Behavior

- Immutable check-ins save note, health, permitted versioned metric changes, graph-aware score snapshot, objective/ancestor/dependent versions, actor audit and notifications in one transaction. Editors/contributors can update all metrics; key-result owners can check in with own-metric changes. Viewers/followers/unassigned members cannot check in. Duplicate/foreign metrics, invalid binary values, stale versions and structural fields fail. Draft/active live work accepts check-ins; closed/archived work must reopen/unarchive. Corrections are new entries.
- Snapshots retain scoring mode, all metric definitions/current values/versions, changed-value before/after records and direct-child state/weights/progress. Child-mode snapshots use the same graph scoring as live objectives. Historical entries survive later numeric changes, reassignment, metric removal, archive and suspension.
- Permanent timestamped comments for active non-viewers on any tenant-visible objective, including archived/closed discussion. Comments/check-ins have no edit/delete API; database triggers reject updates. Paginated sections display historical author identity, exact dates, health and scores; expandable snapshots and a progress line chart accompany check-ins.
- Organization activity includes only objective audit events/notes, newest first, with pagination and current-access links. Administrative events remain in restricted history. Overview shows the five newest objective events. Full-page details and graph panels share collaboration controls.
- Assignment changes notify affected old/new leads, co-owners, contributors, followers and metric owners. Comments/check-ins notify current participants/followers once per account. Actor and inactive accounts/memberships are excluded. Per-objective mute persists independently of assignments; follow/unfollow remains self-managed. Notifications are private to user/tenant and offer unread filtering, read/unread, read-all and access-checked objective links. Sidebar unread counts poll every 30 seconds.
- Trusted-host mail diagnostics report aggregate states, latest 50 statuses and oldest 50 exhausted failures, omitting addresses, subjects, payloads and raw errors. Audited retry requires an exhausted unsent row, SMTP mode and active actor identity. Tenant HTTP admins gain no global-account mail access. Existing worker exclusive claims, five bounded automatic attempts/backoff, generic errors, sent timestamps and delivered-payload scrubbing remain intact. Retry does not renew expired/replaced action tokens.
- Seventh additive migration adds tenant-aware notification preferences, unread index, note/text checks and update-rejection triggers. Shared contracts, API/frontend integration, lazy collaboration loading, twelve PostgreSQL scenarios and six desktop/mobile checks accompany the chapter. Changed-file inventory is in PROGRESS; no dependencies were changed.

### Verification Evidence

- Docker API/web/tools/browser builds pass; final web rebuild includes shared/API/web TypeScript checks and Prisma generation. Explicit Prisma validation and base/test/development Compose configuration checks pass. Main JS remains about 497 kB, collaboration about 13 kB and graph about 224 kB before gzip, without a chunk-size warning.
- Seventh migration applies to existing PostgreSQL; final startup reports seven migrations/no pending work and migration exit 0. Earlier clean-database/persistence evidence remains historical and is not counted as CH07 verification.
- `docker compose run --rm --no-deps tools npm test`: 20/20 unit/API checks pass.
- `docker compose run --rm --no-deps tools npm run test:integration`: 86/86 PostgreSQL checks pass, including all account/security, organization/offboarding, lifecycle/scoring and graph regressions.
- New database coverage verifies atomic batch/snapshot/health/version/rollup updates; own-metric/editor/contributor/viewer boundaries; stale, duplicate, foreign and invalid input rollback; audit and notification failure rollback; creation/reassignment rollback; deduplicated recipients, actor/inactive exclusion, mute and independent read states; cross-tenant notifications/activity even for a user in both tenants; archived authorship; SMTP/session/Origin/CSRF guards; and distinct-account check-in/check-in and check-in/completion races.
- Mail diagnostics/retry tests verify safe metadata, single successful concurrent retry with an actor audit, unchanged action semantics, one worker send and sent-payload scrubbing. Existing account tests retain retry/backoff/exhaustion, exclusive-worker, token replay and real-mail coverage. The actual `docker compose exec api npm run mail:status -w @okr/api` command succeeds in self-hosted mode and returns safe empty-queue status.
- Full built self-hosted browser run: 58 passed, 2 expected SMTP-only skips. Full SMTP browser run: 60/60 passed, including real Mailpit verification/reset/invitation delivery. Both use `--retries=0` and the real first-party API. Final affected run also passes all six new desktop/mobile collaboration checks.
- New browser workflows verify contributor check-ins/health/values, permanent correction and prior scores, snapshots/chart, graph-panel history, organization activity/overview, assignment delivery, viewers/following, comment recipients, mute/enable, unread/read/read-all, archived discussion and links, stale check-in rejection with zero entries then successful reload. Existing graph/panel keyboard/focus, administration and ownership/lifecycle checks pass.
- Desktop/mobile check-in/progress, notification and activity screenshots inspected in artifacts; layouts are readable and horizontal-overflow checks pass.
- Scoped fixture check reports fixtureUsers=0 and fixtureOutbox=0. Normal localhost smoke returns frontend 200, health ok, database connected, self-hosted mode, valid Origin/CSRF validation 400 and forged-Origin 403. Smoke script is retained in artifacts/ch07-smoke.mjs.
- Total distinct checks: 166 (20 unit/API + 86 PostgreSQL + 60 browser). Repeated runs and modes are not additional tests.

### Corrections During Verification

The new distinct-account race exposed a real deadlock: transaction A held the organization lock and attempted a notification FK reference to account B; B held its account FOR UPDATE lock while waiting for the organization. Account locks now use FOR NO KEY UPDATE, which remains exclusive for non-key account/session mutations while allowing foreign-key KEY SHARE references. Account IDs/emails are not changed by these operations. The compatibility follows [PostgreSQL 18 row-lock documentation](https://www.postgresql.org/docs/18/explicit-locking.html); the final full database regression verifies account/session/token serialization, organization races and the new collaboration races with this correction.

Browser helpers initially attempted login while already authenticated, and a comment assertion could match a controlled textarea before its request committed. Explicit logout and assertions on saved list entries fix the helpers. Exact check-in accessible labels were added because nested hint/option text complicated label lookup. A transient test-runner step message occurred during a source reload in the initial failing run; clean final runs have none. Final required workflows pass without retries; failing runs are superseded and are not acceptance evidence.

### Limits, Review Topics and Running State

Review the atomic check-in/correction workflow, snapshot chart, contributor versus metric-owner rights, archived comments, activity readability, notification recipients/mute/read states and trusted-host mail diagnostics. Charts represent recorded check-ins on the current page, not every numeric mutation. Notifications are in-app with periodic counts/manual reload; collaboration emails/push are not delivered. Existing in-memory graph snapshot/large-organization limits remain unbenchmarked. SMTP remains at-least-once after acceptance/crash; retry never renews action links. Retention, platform controls, production operations and full release acceptance remain later chapters.

Normal built runtime restored at http://localhost:8080 with localhost origin, self-hosted delivery and normal throttles. Database/API/Mailpit healthy; Nginx web and optional worker running. Worker deliveryEnabled=false; seven migrations applied. Mailpit may retain synthetic messages whose action records were deleted. No build/test/command sessions remain active; no required CH07 task or unresolved decision remains. No Git commits/tags or external deployment were created. Stop for R007 review; user acceptance is pending. The next continuation authorizes CH08 professional frontend completion as recorded in PROGRESS.

## R008: Professional Frontend Completion

Date: 2026-10-09 | Chapter: CH08 | Status: ready for review

### Authorization and Scope

The user's "next chapter" authorizes CH08 after verified R007, under the existing stop-after-each-chapter policy. No additional explicit acceptance decision is inferred. Actual source/runtime inspection confirmed the checkpoint and no Git repository. Existing product decisions and user changes, including the Dockerfile comment, are preserved. CH09 platform/production work and CH10 release are not included.

### Delivered Behavior

- Navigation groups Planning, Collaboration and Organization. The fixed desktop sidebar scrolls at short heights. Mobile navigation uses the existing Radix dialog dependency, with a named close control, contained keyboard focus, Escape/backdrop dismissal and focus restoration. Navigation or organization selection closes it and focuses main content. Path/organization transitions focus main and reset page scroll; filter/query changes keep control focus. Workspace/account browser titles describe the route; the top-bar account name opens settings.
- Protected routes retain path, query and hash through sign-in. Existing authentication/session/Origin/CSRF behavior remains unchanged.
- Explorer/My objectives expose existing API health/scope filters and 10/25/50/100-item pages alongside search, planning period, team, lead, lifecycle, archive, inclusive date overlap, sorting and direction. Filters start collapsed on unfiltered visits and expanded for URL visits. Show/Hide preserves values/results; a live result/filter count and Clear filters retain sorting/page size while resetting page. Empty numbered pages offer first-page recovery. Objective rows indicate unfinished prerequisites.
- Opening a result carries its explorer/My objectives URL into Back to results, surviving detail reload. Full-page and graph-panel details offer keyboard section links to key results, relationships, collaboration, ownership, lifecycle and history; links move focus as well as scrolling. Existing permission, lifecycle and conflict/reload controls still determine allowed updates.
- Dashboard links each unique unarchived lifecycle count and active-on-track work to the explorer, names the active denominator and organization timezone, and shows recently changed work/activity. Existing active progress/overdue calculations and graph scoring remain the API's responsibility.
- Team cards connect the roster to filtered objectives/alignment. Member search/page, administrative/activity page and notification unread/page state survive reload. Directory/unread changes reset page one. The notification control responds immediately during router transitions and stays synchronized with URL visits. Suspended users without an active organization see activity/notification recovery guidance and can create another organization.
- Consistent action wrapping, metadata/status contrast, focus outlines and mobile icon targets accompany the workflows. Framework code has a separate bundle; graph/collaboration remain lazy. Seven new scenarios run on desktop/mobile (14 checks); earlier My objectives and organization-switch assertions reflect the delivered disclosure/modal behavior.

Changed files: web App.tsx, accounts.tsx, collaboration.tsx, filters.ts, objectives.tsx, organizations.tsx, styles.css and vite.config.ts; browser foundation/objectives/organizations tests; PRD, DEVELOPMENT, README, PROGRESS and this appended ledger. Screenshots, logs and smoke script are under artifacts/. No API/shared/schema/migration/dependency changes, commits/tags or external deployment.

### Verification Evidence

- `docker compose build web browser` passes, including Prisma generation and shared/API/web TypeScript builds. Main JS approximately 418 kB, framework 85 kB, graph 224 kB and collaboration 13 kB before gzip. No chunk-size warning; this is not a load-time/scale benchmark.
- `docker compose -f docker-compose.yml -f docker-compose.test.yml run --rm --no-deps browser npm test`: 20/20 unit/API checks pass.
- The same container command with `npm run test:integration`: 86/86 PostgreSQL checks pass, retaining tenant, role, account, offboarding, lifecycle/scoring, graph, immutable collaboration, atomic audit/notification and concurrent-write coverage.
- Complete built browser suite with `npx playwright test --retries=0`: self-hosted 72 pass and 2 expected SMTP-only skips; SMTP 74/74 pass. Both use the real first-party API; SMTP verification/reset and invitation workflows use actual Mailpit delivery. No first-party mocks or retries.
- New browser checks verify correct server-backed filter combinations, ascending/descending sorting, page sizes and next/previous bounds, reset and out-of-range recovery, URL reload, return to results, team-filter links/nonblank graph, all six section focus targets in full-page and panel, unique lifecycle/health dashboard links, activity/notification paging, unread toggles/read state and directory reload.
- Keyboard checks verify skip-to-content, mobile initial focus and wrapping, Escape/opener restoration, page focus after navigation and organization switching, viewport resize dismissal, route titles and protected query/hash recovery after sign-in.
- A final affected membership-recovery pair passes using the desktop/mobile project widths with an overflow assertion. It confirms no indefinite loading or content access after suspension and available organization recovery.
- Desktop/mobile dashboard, collapsed explorer, full-page details, graph panel, mobile navigation and notification screenshots inspected. Tested layouts have no horizontal page overflow. Existing objective forms, stale-write reload, periods, graphs/child creation, contributor/viewer roles, archived ownership, comments/check-ins/mute and administration regressions pass.
- Prisma validation and base/test + base/development Compose configuration checks pass. Startup reports seven migrations/no pending work and migration exit 0. Safe mail:status succeeds with deliveryEnabled=false and an empty queue.
- Final scoped fixture check: fixtureUsers=0 and fixtureOutbox=0. A check while a suite was active showed two fixture users; only the after-suite zero result counts as cleanup evidence.
- Base smoke through artifacts/ch08-smoke.mjs: frontend 200, health ok, database connected, self-hosted mode, localhost Origin/CSRF validation 400 and forged-Origin 403.
- Total distinct checks: 180 (20 unit/API + 86 PostgreSQL + 74 browser). Repeated runs, modes and the affected pair are not extra tests. Full SMTP stdout is retained in artifacts/ch08-smtp.log; the membership pair is in ch08-membership-viewport.log. The HTML report reflects the final affected pair.

### Corrections During Verification

Two new locators initially used an exact nested select label and the explorer's team label in the graph; matching the actual controls corrected the tests. Adding live roles to every pagination count made older success-status assertions ambiguous and would produce redundant announcements. Pagination remains a named navigation region without extra live statuses.

The unread checkbox revealed a router timing issue: its checked state briefly restored the previous URL value while navigation committed. It now updates immediate local control state, synchronizes on URL changes and performs one URL update per filter change. Member search also uses one update; the shared helper already resets page. Final explicit check/uncheck, URL reset/reload and existing notification workflows pass.

The mobile organization-switch test now verifies the intentional modal close/main focus before reopening navigation to inspect selection. A final membership test uses each project's viewport instead of a generic second browser context. Screenshot capture waits for lazy content/navigation to be available.

One full run began before frontend recreation finished, causing two initial Docker DNS failures. It is superseded by the clean complete self-hosted run after recreation. Earlier fixture-step diagnostics occurred alongside failed browser runs; clean final runs have none. Failed results are not acceptance evidence.

### Limits, Review Topics and Running State

Review grouped/mobile navigation, dashboard shortcuts, explorer disclosure/filter reset/page size, return to filtered results, team links, detail section focus and URL-backed activity/notification/member state. Representative keyboard/semantic/layout checks do not establish formal WCAG certification or every browser/assistive-technology combination. In-memory tenant graph snapshots remain unbenchmarked at large scale. Existing current-page check-in charts, polling/manual notification reload, in-app-only collaboration delivery and SMTP at-least-once/expired-link limitations remain documented. Platform controls, production configuration/backup/restore and integrated release remain CH09/CH10.

Normal built review runtime is restored at http://localhost:8080 with localhost origin, self-hosted mode and normal throttles. Database/API/Mailpit healthy; web and optional worker running; worker deliveryEnabled=false. Seven migrations applied, migration exit 0. Mailpit may retain synthetic messages whose fixture records were removed. No build/test/command sessions remain active; no required CH08 task or unresolved product decision remains. Stop for R008 review; user acceptance is pending. Next continuation begins CH09 platform administration and production operations.


## R008 Layout Review Follow-up: Collapsible Filters and Compact OKR Cards

Date: 2026-10-10 | Chapter: CH08 | Status: ready for review

The user requested collapsible filters on every page, more room for the Alignment/prerequisite relationship views, shorter OKR cards without dates, and icon-only personal/team identification while preserving card widths. This authorizes review revisions to CH08; CH09 and review acceptance are not inferred. Inspection confirmed the prior source checkpoint, no Git repository, healthy API/database and a stopped optional Mailpit. Existing user changes, including the Dockerfile comment, are preserved.

Members search and Notifications unread filters now collapse with accessible Show/Hide controls and active-filter summaries, matching the existing explorer/My objectives/graph controls. Hiding retains URL values and filtered results; reopening and reload preserve applied state. Unfiltered visits start collapsed, applied search/unread visits expanded. Embedded editing/picker forms retain their search inputs.

Graph canvases grow with the viewport and graph help starts collapsed behind How to read relationships. Graph cards preserve 230px width, use a 110px base height plus 32px for each prerequisite/outside-filter warning, and place owner/avatar and scope icon on one row. Dates/planning periods are omitted. Titles use at most two visible lines, retaining the complete text in the tooltip, accessible node name and details panel. Personal/company/team icons have accessible labels and native tooltips, including team names. Explorer/My objectives/overview rows have smaller padding/gaps, no dates/periods and icon-only scope. Graph list entries use compact identities without periods. Details retain dates and scope/team names; relationship details and connection lists retain cross-period/date indicators.

Changed files: apps/web/src/filter-disclosure.tsx (new), objective-identity.tsx, graph-canvas.tsx, relationships.tsx, objectives.tsx, organizations.tsx, collaboration.tsx and styles.css; tests/e2e/objectives.spec.ts and organizations.spec.ts; PRD, DEVELOPMENT, README, PROGRESS and this ledger. Logs/screenshots/smoke script remain under artifacts/. No API/shared/schema/migration/dependency changes, commits/tags or external deployment.

Verification:

- Final Docker web/browser build passes, including Prisma generation and shared/API/web TypeScript checks. No bundle warning.
- The real-API objectives/organizations desktop/mobile run passed 56 checks and failed two new card-height assertions. The fixture includes an unfinished prerequisite, so its card correctly adds 32px; the test expected the base height. After correcting this and measuring canvas height including its border, both new card checks pass. These were test expectation errors, not accepted failures.
- The final graph-help refinement was followed by a clean 14/14 affected desktop/mobile graph run with --retries=0. This rechecks compact cards/icons/dates/title preservation, collapsed help, initially visible nodes, panel sections, graph layout/zoom, filters/outside indicators, edits/version conflicts, child creation, viewer permissions and focus restoration. All 58 distinct affected browser checks pass across the runs; four are new. Repeated checks are not counted again.
- Member/unread filter checks verify keyboard toggling, hidden controls, unchanged filtered results and URLs, reopening and reload. Existing objective/organization workflows pass. Desktop/mobile alignment/prerequisite screenshots inspected; tested page/card overflow checks pass.
- Final runtime smoke: frontend 200, health ok, database connected, self-hosted mode; browser fixtureUsers=0 and fixtureOutbox=0. Seven migrations, no pending work, migration exit 0. Unit/database suites and SMTP mode were not rerun for these frontend changes; their previous CH08 results remain historical evidence.

Evidence: artifacts/r008-layout-graphs.log, r008-compact-{alignment,dependency}-{desktop,mobile}.png, final 14-check HTML report and r008-layout-smoke.mjs. Normal built runtime restored at http://localhost:8080 with localhost origin and normal throttles; database/API healthy, web/worker running, optional Mailpit still stopped. No build/test/command sessions remain active. Review filter disclosures and graph/card density. Stop for R008 review; next continuation begins CH09.


## R008 Graph Title-row Review Follow-up

Date: 2026-10-10 | Chapter: CH08 | Status: ready for review

The user requested less space between the OKR title and other information on Alignment/prerequisite cards, plus a different color for the title row. This authorizes another CH08 review revision; no acceptance or CH09 continuation is inferred. Workspace inspection confirmed the preceding layout revision and healthy normal Docker runtime. Existing user changes and previous product decisions were preserved.

Both graphs now use a pale teal title row spanning the card width, dark teal title text and a subtle divider. Removing the fixed 36px title height eliminates the reserved empty second line for short titles. Owner-row margins are removed and graph content gaps reduced from 5px to 3px. Long titles remain limited to two visible lines with full tooltip/accessible title and details. Card widths/heights, scope icons, warnings and API interactions retain the previous behavior.

Source changes: apps/web/src/graph-canvas.tsx and styles.css. Documentation: PRD, README, DEVELOPMENT, PROGRESS and this review ledger. No tests, API/shared/schema/dependencies changed. No Git commits/tags or external deployment.

Verification: Docker web/browser build passes with shared/API/web TypeScript checks. Eight existing real-API desktop/mobile graph scenarios pass with --retries=0, covering Alignment/prerequisites, compact cards and overflow, dates retained in details, scope icons, graph filter/layout/zoom controls, panel edits/version conflicts and keyboard focus restoration. Desktop Alignment and mobile prerequisite screenshots inspected; tinted headers and tighter spacing are visible. Unit/database/SMTP suites were not rerun for this styling-only change. Earlier evidence is preserved; this run uses artifacts/r008-title-row.log and artifacts/r008-title-row/ (screenshots, HTML report and results).

Normal built runtime restored at http://localhost:8080 with localhost origin, self-hosted mode and normal throttles. API/database healthy; web/worker running; optional Mailpit remains stopped. Smoke via the existing artifacts/r008-layout-smoke.mjs returns frontend=200, health=ok, database=connected, emailMode=selfhosted, fixtureUsers=0 and fixtureOutbox=0. No build/test/command sessions or unfinished requested changes remain. Stop for R008 review; next continuation begins CH09.


## R008 Graph Card Sizing, Progress Tint and Single-line Titles

Date: 2026-10-10 | Chapter: CH08 | Status: ready for review

The user requested Alignment cards 10% wider, another 10% shorter, a subtle green tint when an objective reaches 100%, and titles clipped after one visible line. This supersedes the prior width/height/two-line-title decisions. The shared card renderer applies the design to Alignment and prerequisites. No CH09 continuation or acceptance is inferred. Workspace inspection confirmed the prior revision and healthy Docker runtime; existing user changes were preserved.

Cards now measure 253px wide (230 × 1.1) and 99px tall before warnings (110 × 0.9). One/two-warning cards use 128px/157px heights, reducing the prior sizes by 10% with whole-pixel rounding. Dagre dimensions and center offsets match. Long titles stay on one line with ellipsis; the full name remains in the native tooltip, accessible node name and details panel. A subtle green body/header tint appears when API-provided progress reaches 100%, including active work, and clears below 100%. Lifecycle labels remain separate. The pale teal title row, compact ownership/scope icons and dates in details remain delivered.

Changed files: apps/web/src/graph-canvas.tsx, styles.css and tests/e2e/objectives.spec.ts; PRD, README, DEVELOPMENT, PROGRESS and this ledger. The existing card scenario was updated for dimensions, single-line clipping/full-title access and live progress/tint changes. No new test scenarios or API/shared/schema/dependency changes, Git commits/tags or external deployment.

Verification: Docker web/browser build passes, including shared/API/web TypeScript checks. Eight affected desktop/mobile graph scenarios pass against the real first-party API with --retries=0. The card scenario checks both graph types and changes a real key result through the panel from 99% to 100% and back to 99%, verifying the tint appears and clears without changing lifecycle. Full-title/date details, dimensions/title clipping, overflow, scope icons, graph filters/layout/zoom, panel edits/conflicts and keyboard focus restoration pass. Desktop Alignment/mobile prerequisite screenshots inspected. Unit/database/SMTP suites were not rerun for this frontend revision.

Separate evidence preserves previous artifacts: artifacts/r008-card-sizing.log and artifacts/r008-card-sizing/ (screenshots, HTML report and results). Normal review runtime restored at http://localhost:8080 with localhost origin, normal throttles and self-hosted mode; API/database healthy, web/worker running, optional Mailpit remains stopped. Smoke via artifacts/r008-layout-smoke.mjs returns frontend=200, health=ok, database=connected, emailMode=selfhosted, fixtureUsers=0 and fixtureOutbox=0. No build/test/command sessions or unfinished requested changes remain. Stop for R008 review; next continuation begins CH09.


## R008 Public Signup Startup Flag

Date: 2026-10-10 | Chapter: CH08 | Status: ready for review

The user requested a startup flag that defaults to true and removes signup, then explicitly confirmed that invitation-based onboarding must remain available. This authorizes the account configuration review revision; CH09 continuation and review acceptance are not inferred. Workspace inspection confirmed the existing chapter/review source and Docker runtime. Existing changes and prior layout/card decisions are preserved.

DISABLE_SIGNUP=true is now the default in account startup configuration, base Compose and .env.example. Only literal true/false values are accepted. When disabled, the public Create account link is hidden, /signup redirects to sign-in, and valid public registration requests receive 403 SIGNUP_DISABLED before password hashing or account/organization/outbox writes. API session metadata exposes signupEnabled so the UI follows the server configuration without a web rebuild. Valid invitations retain email, expiry, single-use and tenant validation; invalid invitation tokens cannot bypass the restriction. Existing login, recovery and authenticated organization creation remain available.

Set DISABLE_SIGNUP=false in .env and run docker compose up -d api to enable public registration. README includes this startup command and initial-account provisioning for an empty installation. Acceptance Compose explicitly enables signup for existing fixtures unless TEST_DISABLE_SIGNUP=true selects the disabled checks.

Changed source/config: apps/api/src/accounts/security.ts and routes.ts; packages/shared/src/index.ts; apps/web/src/accounts.tsx; docker-compose.yml, docker-compose.test.yml and .env.example. Tests: apps/api/test/security.test.ts, foundation.test.ts and integration account/organization/objective fixtures; new tests/e2e/signup-settings.spec.ts. PRD, README, DEVELOPMENT, PROGRESS and this ledger updated. No schema/migration/dependency changes, Git commits/tags or external deployment.

Verification:

- Docker API/web/browser build passes, including Prisma generation and shared/API/web TypeScript checks. Unit/API 21/21 and full PostgreSQL 88/88 pass. Default/explicit/invalid flag parsing is covered.
- Database tests cover disabled public signup with no account/organization/outbox writes, accurate session metadata, existing Origin/CSRF enforcement, invalid invitation rejection, valid invitation creation/replay prevention and existing-user login in self-hosted and SMTP configurations.
- Real first-party API browser acceptance with --retries=0 passes 8 enabled-signup checks with 2 expected SMTP-only skips, including existing account/recovery/password/invitation behavior. Disabled mode passes 4/4 desktop/mobile checks for hidden public signup, direct-route redirect, API rejection/no user creation, existing login and real administrator-issued invitation onboarding. Repeated executions across modes are not additional distinct tests. Full SMTP browser acceptance was not rerun.
- Disabled mobile sign-in screenshot inspected; tested pages have no horizontal overflow. Base/test Compose configurations validate.
- Normal runtime restored at http://localhost:8080 with localhost origin, normal throttles, self-hosted email mode and default DISABLE_SIGNUP=true. Final smoke returns frontend=200, health=ok, database=connected, signupEnabled=false, fixtureUsers=0 and fixtureOutbox=0. Database/API healthy; web/worker running; optional Mailpit remains stopped. Seven migrations unchanged; no build/test/command sessions remain active.

Evidence: artifacts/r008-signup-{unit,integration,enabled,disabled}.log; artifacts/r008-signup-enabled/ and r008-signup-disabled/ (screenshots/reports); artifacts/r008-signup-smoke.mjs. Review the default-disabled startup behavior, explicit false override and preserved invitation onboarding. No unfinished requested changes or unresolved product decisions remain. Stop for R008 review; next continuation begins CH09.


## R008 Three-row Graph Card Review Follow-up

Date: 2026-10-10 | Chapter: CH08 | Status: ready for review

The user requested Alignment cards with only three rows (title, assigned person/scope, percentage/state), right-aligned third-row content and no additional reserved height. This supersedes the prior 99px base/expanded-warning heights. The shared renderer applies the design to both Alignment and prerequisites. No CH09 continuation or review acceptance is inferred. Workspace inspection confirmed the previous source/review checkpoint and normal Docker runtime; existing changes and decisions are preserved.

Cards retain 253px width and now use 80px height around exactly three rows. The tinted title clips to one line; the owner/scope row remains compact; percentage and lifecycle align right. Unfinished-prerequisite and outside-filter warnings appear as small accessible tooltip icons alongside progress, retaining information without extra rows. Details and the list retain expanded warning information. Selection changes border color/outline without resizing content. Dagre dimensions/center offsets match. Full-title access, dates in details, scope labels and green-at-100% behavior remain delivered.

Changed files: apps/web/src/graph-canvas.tsx, styles.css and tests/e2e/objectives.spec.ts; PRD, README, DEVELOPMENT, PROGRESS and this ledger. The existing card scenario now checks the three rows, tight dimensions, right-aligned status and both warnings together. No new test scenarios or API/shared/schema/dependency changes, Git commits/tags or external deployment.

Verification: Docker web/browser build passes with Prisma generation and shared/API/web TypeScript checks. Eight affected real-API desktop/mobile graph checks pass with --retries=0. Both graph types verify 253px × 80px cards with/without warnings, exactly three rows, no unused vertical area/overflow, icon labels/tooltips, clipped titles/full details, scope icons, live 99 → 100 → 99 tint, graph filters/layout/zoom, panel edits/version conflicts and keyboard focus restoration. Desktop Alignment/mobile prerequisite screenshots inspected. Unit/database/SMTP suites were not rerun for this frontend revision; prior evidence remains historical.

Evidence: artifacts/r008-three-row.log and artifacts/r008-three-row/ (screenshots, HTML report and results). Normal built review runtime restored at http://localhost:8080 with localhost origin, self-hosted mode, normal throttles and DISABLE_SIGNUP=true. Smoke via artifacts/r008-signup-smoke.mjs returns frontend=200, health=ok, database=connected, signupEnabled=false, fixtureUsers=0 and fixtureOutbox=0. Database/API healthy; web/worker running; optional Mailpit remains stopped. Migrations unchanged and no build/test/command sessions remain active. No unfinished requested changes or unresolved product decision remains. Stop for R008 review; next continuation begins CH09.


## R008 Graph Status, Health, Branch Collapse and Team Colors

Date: 2026-10-10 | Chapter: CH08 | Status: ready for review

The user requested completed card status, health icons, removal of Alignment arrows, optional child collapsing, main-objective markers and team colors. The user explicitly chose to retain the completion action/closing note and show 100% as achieved. This authorizes the graph review revision; no automatic lifecycle mutation, CH09 continuation or review acceptance is inferred. Workspace inspection confirmed the previous three-row revision and healthy Docker review runtime. Existing changes and prior product decisions are preserved.

Active graph cards and list entries at 100% show Achieved; objectives explicitly completed show Completed. Live graph node updates now follow refreshed data while retaining collapse preferences. Completing/reopening via the real details panel and reload reflects the persisted lifecycle. On track/at risk/off track have distinct green check/amber triangle/red cross icons with labels and tooltips, including graph/list cards and objective rows/details.

Alignment links use solid lines without arrowheads; prerequisites retain dashed amber arrows. Parent chevrons in the title row collapse/expand children; Expand all children resets preferences. Branch visibility follows paths from visible roots through expanded parents, so shared children remain when another expanded parent reaches them. Nested collapse state persists when ancestors are hidden/reopened. Preferences survive data refresh and browser reload in tab storage per organization/membership. A visible-count summary describes canvas visibility; all matching objectives remain in the list. These display preferences do not alter graph links, scores, permissions or completion rules.

A star marks main objectives with no alignment parents in the full tenant graph. The API adds alignmentParentCount under the existing tenant-scoped snapshot; filtering a parent out does not turn its child into a main objective. Team title colors/accents are generated consistently from team identity across graph cards, objective/connection lists and the team directory; reloads/renames retain them. The 100% green tint takes priority while preserving a team accent. Cards retain 253px width, 80px height, three rows, clipped titles and right-aligned progress/status.

Changed source: apps/api/src/objectives/relationships.ts; apps/web/src/graph-canvas.tsx, relationships.tsx, objective-visuals.tsx (new), objectives.tsx, organizations.tsx and styles.css. Tests: apps/api/test/integration/objectives.test.ts and tests/e2e/objectives.spec.ts. Two new browser scenarios add four desktop/mobile checks; prior card/graph checks are reused. PRD, README, DEVELOPMENT, PROGRESS and this ledger updated. No schema/migration/shared contract/dependency changes, Git commits/tags or external deployment.

Verification:

- Docker API/web/browser build passes, including Prisma generation and shared/API/web TypeScript checks. All 21 unit/API and 88 PostgreSQL tests pass. Extended graph assertions verify actual roots, child parent counts and filtered-out parents without exposing foreign data.
- Real first-party API objective/organization desktop/mobile regression passed 60 of 62 checks. The new completion scenario used getByLabel with an exact select-label match and timed out in both projects before mutating lifecycle. The corrected accessible combobox locator passes; this was a test locator error.
- A clean final 14/14 affected graph run passes with --retries=0: both graph types, actual completion/reopen/reload, Achieved versus lifecycle, all three health icons, stable team colors/card accents, parent/main indicators under filtering, shared-child/nested collapse, persisted preferences, keyboard toggles without opening details, arrowhead distinctions, existing dimensions/overflow/green tint, filters/layout/zoom, edits/conflicts and child creation. All 62 distinct affected checks pass across the runs; repeated executions are not counted again. Full SMTP browser acceptance was not rerun.
- Desktop team-status Alignment and mobile shared-branch screenshots inspected; tested page/card overflow checks pass. Reports/screenshots remain under artifacts/r008-graph-interactions/ and r008-graph-interactions-final/, with logs artifacts/r008-graph-interactions-{unit,integration,browser,final}.log.
- Normal runtime restored at http://localhost:8080 with localhost origin, normal throttles, self-hosted email and DISABLE_SIGNUP=true. Smoke via artifacts/r008-signup-smoke.mjs returns frontend=200, health=ok, database=connected, signupEnabled=false, fixtureUsers=0 and fixtureOutbox=0. API/database healthy; web/worker running; optional Mailpit remains stopped. Seven migrations unchanged; no active build/test/command sessions.

Review explicit status/health indicators, generated team colors, main-objective markers and collapsed branches. No unfinished requested changes or unresolved product decisions remain. Stop for R008 review; next continuation begins CH09.


## R008 Health Circles, Star Removal and Stable Collapsing

Date: 2026-10-10 | Chapter: CH08 | Status: ready for review

The user requested removal of main-objective stars, plain colored circles for On track/At risk/Off track, and fixed card placement during collapse in the graph views. This supersedes the preceding star/health-symbol design. No CH09 continuation or review acceptance is inferred. Workspace inspection confirmed the prior source/review checkpoint and healthy normal Docker runtime. Earlier user changes and product decisions are preserved.

Stars are removed from graph title rows, with their unused import/styles. The shared health indicator renders a solid 10px green, amber or red circle and retains its full native tooltip/accessibility label in graph/list cards and objective rows/details. Separate prerequisite and outside-filter warnings retain their previous indicators.

Dagre now calculates coordinates for the complete matching graph separately from collapse visibility, in both graph views. Child collapse/expand and Expand all hide/restore cards and edges without relaying out the visible subset or changing viewport/zoom. The visible-count/reset toolbar reserves at least 22px so the reset control does not shift the canvas. Shared children remain through another expanded parent, nested choices persist, and browser-tab collapse preferences remain available. Existing Alignment lines without arrows/prerequisite arrows, team colors, Achieved versus explicit Completed status, green tint and three-row 253px × 80px cards remain delivered.

Changed source: apps/web/src/graph-canvas.tsx, objective-visuals.tsx, relationships.tsx and styles.css. Tests: existing scenarios in tests/e2e/objectives.spec.ts; no new scenarios. PRD, README, DEVELOPMENT, PROGRESS and this ledger updated. No API/shared/schema/migration/dependency changes, Git commits/tags or external deployment. Prior API root-count metadata remains unchanged.

Verification: Docker web/browser build passes with Prisma generation and shared/API/web TypeScript checks. Initial affected browser run passed 14 of 16 checks; the new absolute-screen-coordinate assertion treated normal document scrolling to the Expand all button as card movement. The corrected assertion compares x/y/width/height relative to the graph canvas (within half a pixel), checking actual graph placement and zoom. Source geometry stayed fixed; this was a test coordinate-reference error.

The final clean 16/16 desktop/mobile real-first-party-API run passes with --retries=0. Both graph types verify circle colors/shape/labels, no stars, dimensions/no overflow, stable colors/status/tint and actual completion/reopen. Branch checks cover fixed remaining-card positions after shared/nested collapse, individual expansion and Expand all, restoring children to their original positions, keyboard toggling without opening details, persisted choices and correct shared-child reachability. Existing graph filters/layout/zoom, panel edits/conflicts/focus and child creation also pass. Unit/database/SMTP suites were not rerun for this frontend revision; historical results are preserved.

Evidence: artifacts/r008-stable-circles.log, r008-stable-circles-final.log and their corresponding screenshot/report directories. Desktop expanded/collapsed screenshots and mobile prerequisite circles inspected. Normal review runtime restored at http://localhost:8080 with localhost origin, normal throttles, self-hosted email and DISABLE_SIGNUP=true. Smoke via artifacts/r008-signup-smoke.mjs returns frontend=200, health=ok, database=connected, signupEnabled=false, fixtureUsers=0 and fixtureOutbox=0. API/database healthy; web/worker running; optional Mailpit remains stopped. Seven migrations unchanged; no active build/test/command sessions.

Review colored health circles, star-free titles and stable card placement during collapse. No unfinished requested changes or unresolved product decisions remain. Stop for R008 review; next continuation begins CH09.

## R009 — CH09 Platform Administration and Operations (2026-10-10)

The user's next-chapter instruction authorized CH09 after R008's requested revisions. R009 is implemented, verified and ready for review. No blanket review acceptance is inferred and CH10 is not started.

Trusted-host platform:bootstrap explicitly creates a verified administrator using password stdin or promotes an existing active account while preserving credentials/verification. It grants no organization membership and repeat promotion is idempotent. Public signup remains disabled by default and never grants platform privileges; invitations remain available. Bootstrap records a trusted-host/target audit, not an authenticated OS operator identity. No existing real user account was promoted during delivery.

Protected /platform and /api/v1/platform users/organizations/audit support global activation, search/pagination, collapsible URL filters, confirmation/reasons, optimistic versions and atomic actor/target/before/after/reason/version history. Ordinary accounts cannot use these controls. Platform administrators cannot read tenant objectives without membership. Global suspension checks every tenant for a globally active owner and every lead/co-owner/contributor/key-result-owner reference, including closed/archived work. Account/sorted tenant locks and a platform mutation gate serialize owner demotion/new assignment/admin departures; the last active platform administrator is preserved. Sessions/action tokens are revoked and manager designations cleared with team versions; membership/history survives and reactivation does not restore scoped suspensions/designations/tokens. Organization activation requires an active owner.

Production API/worker configuration guards, trusted-host preflight, loopback production web overlay, database-driven container readiness and rotating query-free logs are delivered. SMTP validates sender/relay/port/paired credentials and requires implicit TLS or STARTTLS in production. README covers first-admin onboarding, SMTP/self-hosted links/outbox diagnostics, explicit secrets, HTTPS topology, volumes, upgrades/migration failure recovery and protected backups. No external HTTPS/certificate deployment, monitoring service, automatic retention job or demo seed is claimed. External proxies currently share throttles unless trust/IP topology is changed.

Backup/restore scripts use container pg_dump/pg_restore and docker compose cp rather than PowerShell binary pipes. Restore always creates a unique isolated database with an atomic pg_restore, without overwriting the live database or starting API/workers there. The actual isolated drill matches counts and hashes for all 20 tables/30 rows, including eight migrations, account/membership/session/action/invitation data, teams/periods, metrics/graphs, frozen lifecycle, comments/check-ins/preferences/notifications/audits/outbox. Representative restored score/current=75 and comment/check-in/alignment references are intact. Backup overwrite rejection was checked. The three explicitly created test/restore databases and synthetic dump were removed; live data was preserved. Protected retention and revoking restored access tokens/reviewing queued mail before a real disaster cutover are documented operator tasks.

Changes: new API platform/access/bootstrap/routes and operations/check/environment modules; API app/server/worker/package scripts; User.version and eighth migration; web platform/App/styles; base/production Compose and Nginx logs; PowerShell backup/restore/production verification and isolated-test/drill scripts; API environment/platform and new browser platform tests; PRD/README/DEVELOPMENT/PROGRESS/this ledger. No dependency additions, Git repository commits/tags, actual account promotion or external deployment. Existing Dockerfile comment and prior graph/signup product decisions preserved.

Verification: Docker API/web/tools/browser builds and shared/API/web TypeScript/Prisma generation pass. Final complete backend run in a fresh isolated database passes 24/24 unit/API and 99/99 PostgreSQL checks, zero skips. Existing authentication, tenancy, roles, scoring, graph/collaboration races and audit rollback remain passing; new cases cover bootstrap, protected platform reads/writes, redacted pagination, optimistic versions, global archived offboarding, owner/admin preservation, concurrent owner demotion/new assignment and injected audit rollback. Eight migrations applied, no pending work. Base/development/test Compose validate; production overlay/preflight accepts synthetic safe settings and rejects HTTP/weak secrets/insecure API and worker startup. Trusted-host status works in both email modes without payload exposure. Final live Nginx/API query/header marker check passes.

Affected real-first-party-API desktop/mobile browser acceptance with zero retries: self-hosted 16 passes + 4 expected mode-specific skips; final styled platform + actual Mailpit verification/reset SMTP 10/10; disabled public signup/existing login/invitation onboarding 4/4. Repeated modes/scenarios are not additional distinct checks. Desktop/mobile screenshots inspected and overflow assertions pass. Full integrated browser/release verification remains CH10. Final Nginx log-only correction was verified by rebuilding/typechecking, live log probe and runtime smoke; browser suites were not repeated for that logging-only change.

Corrections found before acceptance: Prisma could not deserialize the advisory lock's void result (cast to text); isolated suite must retain normal auth throttles; fixture notification references needed cleanup before objectives; tab URL reset needed an assertion before refilling identical search text; new platform rows needed existing responsive card styles; Nginx's inherited combined log needed a server-level replacement. The final backend run has no leftover-fixture skips. Initial failed/partial runs remain evidence but are not counted as passes.

Evidence: artifacts/ch09-build-final.log, ch09-tools-final.log, ch09-web-final.log, ch09-web-log-final.log, ch09-backend-verified.log; ch09-browser-verified/, ch09-smtp/, ch09-signup-disabled/ and matching logs; ch09-production.log; ch09-backup.log, ch09-restore.log, ch09-restore-seed.log, ch09-restore-verified.log; ch09-mail-status-{smtp,selfhosted}.log, ch09-migration-status.log, ch09-log-hygiene.log, ch09-runtime-smoke.log. Earlier runs retained separately.

Normal runtime restored at http://localhost:8080: API/database healthy, web/worker running, optional Mailpit stopped; APP_URL localhost, self-hosted email, normal throttles, DISABLE_SIGNUP=true. Final smoke: frontend=200, health=ok, database=connected, emailMode=selfhosted, signupEnabled=false, fixtureUsers=0, fixtureOutbox=0. No active build/test/command sessions or unfinished CH09 work. Review bootstrap/platform boundaries, global suspension safeguards and the operational runbook. Stop for R009 review; next continuation authorizes CH10 integrated acceptance and release evidence.

## R010 / CH10 Integrated Release Verification (2026-10-10)

Status: ready for review. The user requested the next chapter after R009, authorizing CH10 and necessary release fixes. This is continuation authorization, not blanket acceptance of earlier revisions or permission for external deployment. CH10 is the final planned chapter; stop for review.

RELEASE.md records the release results, commands, local access/onboarding and limits. REQUIREMENT_TEST_MATRIX.md maps all 24 numbered PRD requirements and architecture/onboarding/operations scope to executable suites. README now reflects eight migrations and delivered platform controls, documents isolated acceptance and reusable runtime smoke, and identifies that no optional demo seed command is shipped. PRD/DEVELOPMENT/checkpoint are synchronized. Earlier product decisions, existing user data and the Dockerfile comment are preserved.

Acceptance used a separate okr-release-acceptance Compose project with a new network/empty postgres_data volume, synthetic credentials and loopback 8091/18025 ports. Browser fixtures use the built app and real first-party APIs. Integration used fresh okr_ch10_test_release; restore used a newly generated okr_restore_* database. The normal localhost:8080 stack stayed available and separate. No host Node prerequisite, user-account promotion, schema/API/UI/dependency change, Git commit/tag or external production deployment.

Build/backend evidence: docker compose build api web tools browser passes, including Prisma generation and shared/API/web TypeScript builds. Complete isolated checks pass 24/24 unit/API and 99/99 PostgreSQL with zero skips/failures. They cover account/token/Origin/CSRF/session rules, tenant-aware database constraints and API reads/writes, fixed roles/assignments/managers/offboarding/last owners, scoring/lifecycle/period versions, concurrent graph cycles and stale completion, atomic audit/notification rollback, immutable collaboration, and explicit bootstrap/global platform boundaries. Prisma validation and base/development/test/acceptance/production Compose configuration checks pass.

Final full zero-retry browser evidence: self-hosted 90 passes/four expected SMTP-only/disabled-signup skips; SMTP 92 passes/two expected disabled-signup skips with actual Mailpit verification/reset delivery and invitation onboarding. Disabled-signup UI/API, existing login and invited-account creation pass four checks in self-hosted and four in SMTP mode. Across applicable runs all 47 scenarios x desktop/mobile = 94 distinct browser checks pass; repeated modes/runs are not new tests. Combined distinct coverage is 217 (24 + 99 + 94). Keyboard/focus/route/deep-link/permission/conflict/filter/geometry/overflow assertions pass. Representative desktop overview/graph and mobile collapsed graph/details/platform/navigation screenshots inspected. Chromium/emulated mobile only; no formal WCAG or cross-browser certification.

Operational evidence: fresh-volume startup applies all eight migrations and rerun reports no pending work. With the isolated database stopped, /health stays 200 and /ready returns 503; restart preserves the probe, verification removes it, readiness recovers. Production preflight accepts safe synthetic HTTPS settings and rejects HTTP/weak database secrets; API/worker startup reject insecure cookies. Actual trusted-host stdin CLI creates an isolated verified platform fixture and grants zero memberships. API/worker run as node; API/worker/database/web JSON logs rotate at 10 MB x 3. Live synthetic query/authorization/cookie markers are absent from API/Nginx logs and a safe access record is present. Safe mail diagnostics work and final fixture outbox is empty.

Binary-safe backup.ps1 and restore-isolated.ps1 restore without overwriting the live database. Representative source and restored manifests match all 20 table hashes/30 rows, including eight migration records, membership/team/period, metrics/frozen completed score 75, immutable check-ins/comments/audits, notification/preferences and account-mail/token rows. The drill now explicitly verifies parent-to-child alignment and the completed child's prerequisite override. The restored copy never serves API/worker traffic. The separate project's containers/network/volume, all its test/restore databases and synthetic dump were removed after verifying project ownership. Cleanup included workers/mail profiles; removing only default-profile services initially left those two containers/network until the explicit profile cleanup completed. Normal data was untouched.

Corrections found during acceptance: production verification retained the final expected native failure's exit code despite passing its assertions; it now reports success as zero. The restore fixture had its alignment endpoints reversed and lacked a representative override; corrected fixture/verification pass. An initial SMTP mobile screenshot raced a graph filter transition, and a subsequent SMTP recovery request raced sign-out/session refresh and correctly failed CSRF. Tests now await committed filter URL/server results, sign-in after logout and successful generic recovery before polling mail. Clean complete SMTP/self-hosted reruns supersede those failures; no security check or application behavior was weakened. A transient smoke used the previous email-mode expectation during a mode switch and was rerun correctly; it is not counted as acceptance.

Changed files: new docker-compose.acceptance.yml, scripts/release-smoke.mjs, RELEASE.md and REQUIREMENT_TEST_MATRIX.md; scripts/run-isolated-checks.mjs/restore-drill.mjs/backup.ps1/verify-production.ps1; tests/e2e/objectives.spec.ts/accounts.spec.ts; PRD/DEVELOPMENT/README/PROGRESS/this ledger. Manual edits used apply_patch. Evidence: artifacts/ch10-build.log/ch10-backend.log; ch10-{selfhosted,smtp}-verified.log and corresponding screenshots/HTML reports; ch10-disabled-{selfhosted,smtp}.log/reports; ch10-clean-migrations.log/ch10-migration-rerun.log/ch10-restart.log/ch10-db-unavailable.log/ch10-persistence-verify.log; ch10-production.log/ch10-container-settings.log/ch10-log-hygiene.log/ch10-bootstrap.log; ch10-restore-{seed,verify}.log/ch10-backup.log/ch10-restore.log; ch10-mail-status-smtp.log/ch10-runtime-smoke.log/ch10-cleanup.log. Initial browser evidence remains separately named and is not counted as passing release evidence.

Final normal runtime: http://localhost:8080; API/database healthy, web/worker running, optional normal Mailpit stopped; APP_URL localhost, self-hosted email, normal throttles, DISABLE_SIGNUP=true. Smoke after cleanup: frontend=200, health=ok, database=connected, emailMode=selfhosted, signupEnabled=false, migrations=8, fixtureUsers=0, fixtureOutbox=0. No acceptance containers/volumes/network, active build/test/command sessions or unfinished CH10 tasks remain.

Review R010, the local workflows, RELEASE and the complete matrix. No known release-blocking defect remains in exercised workflows. Operator work remains real HTTPS proxy/certificate/SMTP service, backup retention/monitoring and disaster cutover safeguards; external proxies share IP throttles. Graph snapshots have no large-organization benchmark, notifications poll, SMTP can deliver at least once after a crash, retries do not renew links, token/status/audit deletion is not automated, and bootstrap does not authenticate an OS actor. These limits and PRD exclusions remain explicit. No further chapter or deployment starts automatically; acceptance or a new scope is the exact next user action.

## R011 / Single-EC2 Terraform Deployment (2026-10-10)

Status: ready for review. The user requested deployment scripts for the app on only one EC2 and explicitly selected a dedicated VPC. This authorizes script creation and local verification; no Terraform apply or AWS resource creation was performed. Earlier chapter review acceptance is not inferred. Region and public hostname are configurable, and default-disabled signup with invitation onboarding is preserved.

infra/terraform/ec2 provides one AL2023 x86_64 Nitro EC2 (default t3.medium), dedicated VPC/public subnet/IGW, Elastic IP, encrypted root and separate persistent gp3 disk, private/versioned/encrypted release bucket, IAM instance profile and optional existing Route 53 zone/existing public subnet. HTTP/HTTPS are the only ingress; Session Manager supplies management. IMDSv2/hop limit 1, graceful stop before data detach and prevent_destroy on the data disk protect the intended topology/data. There is no RDS, ALB, NAT or second instance. Replacements use the retained data disk and require downtime; network/AZ changes need explicit data migration. Provider lockfile pins AWS 6.68.0; Terraform >=1.9/<2.

The PowerShell packager uses explicit source/build/runtime inputs, rejects source links/junctions, refuses overwrite and excludes credentials, environment files, generated data/state and test/dependency trees. Cloud-init verifies plugin/release hashes and installs Docker/Compose/Buildx, then the exact EBS volume serial determines mounting/formatting. Unknown contents are refused. Protected database password and runtime configuration live outside the release build context on the data disk. Passwords persist across startup/replacement; existing database contents without a valid retained credential fail safely. Optional SMTP comes from a host-decrypted existing SecureString; Terraform never reads the secret value. Explicit parameter denies bound AmazonSSMManagedInstanceCore's broad reads to the selected secret (or none). No administrator is created automatically.

Production Compose runs database/migrations/API/worker/web/Caddy on that same host with persistent PostgreSQL/certificate storage, production migration flags, secure cookies and loopback Nginx. Sequential builds/preflight/migration precede a systemd-managed, database-ready stack. Bootstrap reruns stop writers before migrations. Caddy redirects HTTP, issues public HTTPS when DNS/reachability allow, and removes request URI/headers from error logs; access logging remains disabled. The runbook covers packaging, saved-plan review/apply, DNS, Session Manager, explicit password-stdin administrator onboarding, optional SMTP, maintenance/upgrades, credential preservation, backups and protected destroy. No automatic backup schedule/retention or monitoring is added.

Verification: Terraform format/validate and eight mocked plan contracts pass with no AWS credentials/resources, covering dedicated/default and existing networks/DNS, encrypted disks, IMDSv2, ingress, private artifacts, SMTP scope/required secret, hostname injection and unsuitable memory/architecture/hypervisor. Five Python runtime tests pass. Compose v5.6.0 and Buildx v0.27.0 Linux assets download, match published SHA256 and execute. Rendered user data passes Bash syntax; cloud-init/bootstrap/wrapper pass ShellCheck. Production Caddy configuration validates. The final ZIP has 76 safe inputs and SHA256 b455847d70fad1bb3076bfaf77e424a366a1dbd6e93a3efa46096157dfca0250; API/web builds from the extracted archive pass Prisma and shared/API/web compilation (unchanged application build layers reuse validated cache).

Separate Compose project okr-ec2-check, with synthetic credentials, empty bind-mounted PostgreSQL and ports 18080/18081/18443, exercises the packaged app images. Eight migrations apply successfully. Production API reports disabled signup/secure cookies, SMTP punctuation/quotes/backslash/dollar values round-trip to the actual container, and database readiness passes. The real frontend/API serve HTTPS with hostname validation and a trusted internal test CA; HTTP redirects to HTTPS. A synthetic database record survives container recreation and is then deleted. Deliberately stopping only the test web upstream returns 502; Caddy emits an error record without query/auth/cookie markers. Web is restored before cleanup. No real email delivery was attempted; the synthetic worker uses self-hosted mode. Application sources did not change, so earlier CH10 backend/browser acceptance was not repeated.

Corrections before final evidence: tests must distinguish Compose's serialized dollar escaping from actual environment values and use an HTTP client that preserves Host; an initial persistence script imported Prisma outside its container module path; Caddy validation needs its hostname/contact environment; the ShellCheck image contains no shell entrypoint; Terraform conditional objects need consistent types. The correct final tests supersede those failures. IAM wildcard parameter grants and possible Caddy error-query leakage were resolved and covered before review. No security requirement was weakened.

Changed files: new infra/terraform/ec2 Terraform module/lock/example, cloud-init/bootstrap/runtime renderer/wrapper, production overlay/Caddyfile/runbook/mock tests; scripts/package-ec2.ps1; tests/deployment runtime/fixture/download/HTTPS/proxy checks; .gitignore/.dockerignore; PRD/DEVELOPMENT/README/PROGRESS/this ledger. No application source/schema/migration/dependency changes or Dockerfile edits. Existing user data and prior product decisions remain intact. No Git commit/tag exists in this workspace.

Evidence: artifacts/ec2-terraform-{validate,fmt,test}.log; ec2-runtime-tests.log/ec2-downloads.log/ec2-shellcheck.log/ec2-bash-syntax.log/ec2-caddy-validate.log; ec2-package{,-safety,-build,-web-build}.log; ec2-local-start-final.log/ec2-local-verify.log/ec2-persistence.log/ec2-proxy-failure.log/ec2-caddy-error.log/ec2-cleanup.log/ec2-normal-smoke.log. Final archive/build context are retained in ignored artifacts. Test containers/network/unused volume and synthetic host data/certificate keys/runtime/config credentials are removed. No build/test command is running. Normal http://localhost:8080 runtime remains available: frontend=200, health=ok, database=connected, selfhosted, signupEnabled=false, migrations=8, fixtureUsers=0, fixtureOutbox=0.

Limits: real AWS provisioning, AL2023 package installation/cloud-init/systemd boot, EBS attach/detach, IAM propagation, Session Manager and public ACME issuance are not verified by these local tests. The internal CA is not a public certificate. Single-host downtime, manual backup/retention/monitoring and existing shared proxy throttles remain explicit. Stop for R011 review. Exact operator next action is configure real region/domain/AWS credentials, review/apply the documented plan, point DNS and verify cloud startup/HTTPS before explicit first-admin onboarding. No cloud deployment starts automatically.

## R012 — Outbound Slack notifications and objective updates (2026-10-10)

Status: ready for review. The user requested Slack integration and confirmed sending notifications/objective updates to Slack. No user review acceptance, real Slack request, real account promotion or AWS apply is inferred.

Organization owners/admins configure one incoming webhook through Organization settings. The panel supplies event selections, pause, test, status, failed retry and confirmed disconnect, with desktop/mobile layout and version-conflict reload. The API enforces active tenant/admin/Origin/CSRF/version checks. Slack/GovSlack webhook paths are restricted; AES-256-GCM binds credentials to the organization. Saved credentials never return to the browser or enter audit/error/log output. Plain-text message blocks do not turn objective text into Slack mentions.

Objective, metric, health, lifecycle, ownership and relationship audits queue selected messages in the same database transaction. Check-ins and comments include their note and event-time title/actor/progress/health/state. Check-ins qualify for either event category and create one delivery per audit. Follow changes do not broadcast. Existing explicit completion remains: active 100% reads Achieved (active). Links select the correct active organization after sign-in and reject unavailable tenants. In-app recipient/mute preferences do not restrict the Slack channel audience; this is explained in the UI/runbook.

The existing worker delivers Slack even in self-hosted email mode. Integration locks serialize concurrent delivery/settings while permitting ordinary objective FK writes during HTTP. Rate spacing, Retry-After, bounded exponential attempts, permanent-failure stop and manual retry are implemented. Error output omits URLs/Slack response content. Sent message payloads are scrubbed. Settings saves discard unsent content; disconnect clears credentials/delivery records. Delivery remains at-least-once after acceptance/crash, and an in-flight request can finish during suspension/disconnection. Unsent notes remain in the database until delivery/discard; protect storage/backups and review queues before a live restore. Automatic queue/history retention is not added.

Nine migrations include tenant-aware Slack objective/audit references, unique audit delivery and attempt/version constraints. API/worker startup checks optional SLACK_ENCRYPTION_KEY. The current local runtime has a generated retained key in ignored .env; its value was not printed. EC2 persists a root-only key on the retained data disk and refuses missing/invalid retained encryption, so replacement cannot silently make existing webhook credentials unreadable. No secret enters Terraform or release inputs.

Verification: Docker API/web/tools/browser builds and Prisma/shared/API/web compilation pass. Complete backend run in isolated okr_ch12_test_slack passes 29 unit/API + 107 PostgreSQL checks, zero failures/skips, including existing role/tenant/version/cycle/audit/offboarding/account regressions. The final affected rerun passes all 13 Slack checks after adding progress-only check-in filtering. Tests cover authenticated randomized encryption/tampering/organization binding, URL and redirect restrictions, transport success/429/503/permanent response handling, permissions/CSRF/version/redaction, event snapshots/category filtering, injected queue rollback, outage-safe domain commits, retry/scrubbing, concurrent worker serialization with ordinary writes, suspension/replacement/pause/disconnect and foreign reference constraints. Only the external Slack transport is mocked.

Real-first-party-API browser acceptance covers 70 distinct desktop/mobile scenarios: 62 existing objective/organization workflows plus eight Slack checks. Initial regression run passed 69/70; the mobile link test tried using the selector before opening navigation. Correcting the test gives a clean final eight-check Slack run, zero retries. Final desktop/mobile screenshots inspected; overflow checks pass. Progress filters, pause/disconnect, version conflict/reload, credential hiding, ordinary-member denial and correct/unavailable tenant links are exercised. Existing compact cards, stable collapses, health circles/team colors, metrics/lifecycle/relationships and collaboration remain covered. SMTP browser modes were not repeated; R010's earlier full two-mode release evidence stays historical.

Seven Python runtime checks pass, including retained database/password/Slack-key preservation and missing/invalid key refusal. Base and isolated Compose validate. New release artifacts/okr-ec2-r012.zip has 81 safe inputs, including Slack source and ninth migration, SHA256 3e7513a8625a259d95e70873084ce75c1712a7b6c93252b87930a3417796e192. Packaged API/web images build from its extracted context. R011's original archive/logs remain intact. Deployment fixture now accepts an explicit archive and the verifier derives migration count from that extracted release; syntax validation passes. R011's Terraform/cloud/HTTPS checks were not repeated for this app change and actual AWS deployment remains unverified.

Corrections during verification: first TypeScript build required a header-object annotation in the test; the unit assertion now distinguishes plain-text block types from the top-level mrkdwn=false setting. Targeted test commands initially used nonexistent compiled test files and the wrong isolated synthetic DB credential; corrected TypeScript runner/credential passes. PowerShell Stop treats Docker progress stderr as terminating errors; final build uses the normal exit-code check. The initial mobile selector test was corrected without changing application navigation. Native SQL quote stripping was avoided by piping SQL on stdin for final fixture checks. Initial failures are preserved and not acceptance evidence.

Changed files: apps/api/prisma/schema.prisma and 202610100002_slack_integration migration; src/slack/{service,routes}.ts, app.ts/worker.ts/operations/environment.ts and objective routes/relationships/collaboration audit hooks; API Slack unit/integration tests. Frontend adds slack.tsx/objective-link.tsx and changes App.tsx/organizations.tsx/styles.css, with tests/e2e/slack.spec.ts. Configuration/runtime: docker-compose.yml/new docker-compose.slack-test.yml/.env.example/generated ignored .env; scripts/run-isolated-checks.mjs/release-smoke.mjs; EC2 render-runtime.py; deployment runtime/fixture/verifier tests. PRD/README/EC2 runbook/DEVELOPMENT/PROGRESS/requirement matrix/this ledger updated. No dependency additions, Git commit/tag or Dockerfile edits.

Evidence: artifacts/slack-build.log/slack-build-final.log/slack-ui-build-final.log; slack-backend.log/slack-backend-final.log; slack-browser.log/slack-browser-final.log and their reports/screenshots; slack-runtime.log; slack-package.log/slack-package-{api,web}-build.log; slack-normal-{build,stop,migrate,start,smoke}.log; slack-fixture-cleanup.log/slack-backend-cleanup.log/slack-test-teardown.log. Both isolated databases report zero fixture accounts/integrations/deliveries before scoped project/network/volume deletion. Package and review evidence remain in ignored artifacts. Normal localhost:8080 is restored with frontend=200, health=ok, database=connected, emailMode=selfhosted, signupEnabled=false, migrations=9 and zero fixture accounts/outbox. API/database healthy; web/worker running; optional Mailpit stopped. Worker reports slackEnabled=true; main SlackIntegration count is zero. No real channel is connected, and no build/test sessions remain active.

Final test safety review adds a database-name guard before Slack fixture writes/global mocked delivery claims. The normal database is explicitly rejected (expected nonzero result, slack-live-db-guard.log); README integration commands now use the isolated project/runner. This prevents a test from falsely marking a real Slack message delivered. The complete guarded backend suite is rerun in a fresh isolated database; its result and final teardown are recorded in PROGRESS. This changes test safety only; runtime/release sources and archive hash remain unchanged.

Final guarded full backend rerun passes 29/29 unit/API and 107/107 PostgreSQL checks, zero failures/skips (slack-backend-guarded.log). Fixture accounts/Slack connections/deliveries are zero, and the isolated database/project/network/volume are removed (slack-guarded-cleanup.log/slack-guarded-teardown.log). Final localhost smoke remains healthy with nine migrations and disabled signup (slack-final-smoke.log). No command sessions remain active.

Exact next action: review R012, enter an authorized incoming webhook in Organization settings, save/enable and send a test message to verify the real Slack channel. The implementation is complete; live Slack verification depends on that setup. Use the new R012 ZIP for an EC2 release containing Slack. AWS configuration/plan/apply stays separate operator work; preserve the existing review server. Stop at this review boundary.



