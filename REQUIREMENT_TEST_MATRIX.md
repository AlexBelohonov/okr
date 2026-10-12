# Requirement Verification: R010 Baseline and R012 Slack

Date: 2026-10-10. This matrix maps every numbered requirement in [PRD](PRD.md), plus its architecture, onboarding and operations requirements. R010 baseline results/commands remain in [RELEASE](RELEASE.md); R012 Slack evidence and affected regressions are recorded in [REVIEWS](REVIEWS.md) and [PROGRESS](PROGRESS.md). Historical baseline evidence is not a full rerun of every release scenario after R012. A mapping identifies exercised behavior, not a guarantee about every possible input or deployment.

Test references below link to executable suites. Integration suites use PostgreSQL; browser suites use the built app and real first-party API with isolated fixtures. SMTP browser checks use actual Mailpit delivery.

| Reference | Executable suite |
| --- | --- |
| Security / configuration | [security.test.ts](apps/api/test/security.test.ts), [environment.test.ts](apps/api/test/environment.test.ts) |
| Foundation | [foundation.test.ts](apps/api/test/foundation.test.ts), [foundation.spec.ts](tests/e2e/foundation.spec.ts) |
| Accounts | [accounts.test.ts](apps/api/test/integration/accounts.test.ts), [accounts.spec.ts](tests/e2e/accounts.spec.ts), [signup-settings.spec.ts](tests/e2e/signup-settings.spec.ts) |
| Organizations | [organizations.test.ts](apps/api/test/integration/organizations.test.ts), [organizations.spec.ts](tests/e2e/organizations.spec.ts) |
| Platform | [platform.test.ts](apps/api/test/integration/platform.test.ts), [platform.spec.ts](tests/e2e/platform.spec.ts) |
| Database constraints | [database.test.ts](apps/api/test/integration/database.test.ts) |
| Scoring / relationships | [objectives.test.ts](apps/api/test/objectives.test.ts), [relationships.test.ts](apps/api/test/relationships.test.ts) |
| Objectives / collaboration | [integration/objectives.test.ts](apps/api/test/integration/objectives.test.ts), [objectives.spec.ts](tests/e2e/objectives.spec.ts) |
| Slack | [slack.test.ts](apps/api/test/slack.test.ts), [integration/slack.test.ts](apps/api/test/integration/slack.test.ts), [slack.spec.ts](tests/e2e/slack.spec.ts), [test_runtime.py](tests/deployment/test_runtime.py) |

| Requirement | Exercised acceptance behavior | Evidence |
| --- | --- | --- |
| AUTH-01 | Default-disabled flag/invalid values; hidden signup/direct-route redirect/403 without records; enabled signup; existing login and invitation onboarding in both modes | Security; Accounts (disabled tests explicitly run separately) |
| AUTH-02 | Salted Argon2id, opaque hashed tokens; HttpOnly/SameSite/Secure and seven-day cookie; exact Origin/CSRF rejection; unauthorized profile requests | Security; Accounts; Organizations |
| AUTH-03 | Self-hosted generic recovery and copied reset; unverified SMTP restrictions; actual verification/reset mail; copied invitations and atomic SMTP invitation outbox; single-use actions | Accounts; SMTP browser run; Organizations; Platform |
| AUTH-04 | Session/action/invitation expiry and replay; simultaneous reset consumption; password changes/reset/suspension revoke sessions | Accounts; Platform; Organizations |
| ORG-01 | Multi-organization create/switch/reload; foreign paths/resources hidden even for dual members; tenant-aware foreign keys | Organizations; Database constraints; Objectives / collaboration |
| ORG-02 | Fixed role boundaries, timezone/version checks, memberships, scoped suspension, designated-manager teams, period administration and ownership transfer | Organizations; Objectives / collaboration |
| ORG-03 | Explicit create/promote bootstrap without memberships or inferred privilege; preserved credentials/idempotency; global last-owner protection including suspended tenants/concurrent demotion | Platform; Accounts; actual CLI evidence |
| OKR-01 | Personal/team/company creation, descriptions, lead/roles/metric owners, dates, lifecycle and health; ownership reassignment and role-specific edit access | Objectives / collaboration; Organizations |
| OKR-02 | Inclusive calendar quarters/custom periods/leap years/date validation; period containment/version guards; cross-period relationships and visible differences | Scoring / relationships; Objectives / collaboration; Database constraints |
| OKR-03 | Closing note, frozen score, completion/reopen/archive; exclusion of draft/cancelled/archived children; historical ownership preserved | Scoring / relationships; Objectives / collaboration |
| OKR-04 | Increase/decrease/binary values, positive weights, rejected equal targets/nonbinary values; clamping and empty scores | Scoring / relationships; Database constraints; Objectives / collaboration |
| OKR-05 | Multiple parents, unequal parent weights, unique totals, children versus metric mode; excluded child states, empty inputs, frozen parents and live reopen | Scoring / relationships; Objectives / collaboration |
| OKR-06 | Stale objective/metric/period versions and UI reload; simultaneous edits/completion; forced audit/notification failure rolls back values, versions and snapshots | Objectives / collaboration; Organizations; Platform |
| GRAPH-01 | Separate alignment/dependency graphs; parent-to-child and prerequisite-to-dependent orientation; multiple parents and shared children | Scoring / relationships; Objectives / collaboration; restore drill |
| GRAPH-02 | Self/duplicate/foreign/indirect cycle rejection; opposing concurrent link requests and refreshed retries cannot create cycles | Scoring / relationships; Database constraints; Objectives / collaboration |
| GRAPH-03 | Both alignment editors versus dependent-only prerequisite editing; viewer/contributor denial; positive parent weights and endpoint versions | Scoring / relationships; Objectives / collaboration |
| GRAPH-04 | Unfinished/archived prerequisites warn without changing scores; metric work permitted; completion requires separate override and retains immutable prerequisite snapshot | Objectives / collaboration |
| GRAPH-05 | Nonblank left-to-right graph, edge styles, zoom/fit, keyboard list/panel; filters/outside indicators; atomic child creation/conflict recovery; 253 x 80 three-row clipped cards, health circles/Achieved/Completed/team colors; shared/nested/persisted collapse without coordinate or viewport changes in either view | Objectives / collaboration; graph screenshots and geometry assertions |
| LOG-01 | Multiple-metric check-ins with author/date/health/score snapshots; corrections append; stale/foreign/unauthorized batches roll back; immutable database records | Objectives / collaboration |
| LOG-02 | Timestamped immutable comments, closed/archive readability, preserved authorship; objective/admin/global actor audits; transaction rollback on audit failure; token-redacted lists/history and safe errors/logs | Objectives / collaboration; Organizations; Platform; Foundation; live log probe |
| NOTIFY-01 | Assignment/metric-owner/comment/check-in recipient deduplication, actor/inactive exclusion, mute, follow, unread/read/all-read and tenant ownership checks; outbox claims/retries/scrubbing and audited exhausted retry | Accounts; Objectives / collaboration; actual SMTP worker delivery |
| SLACK-01 | Owner/admin-only configuration; tenant/Origin/CSRF/version rejection; authenticated encryption bound to organization; credential redaction; UI connection/reload/conflict/pause/disconnect | Slack |
| SLACK-02 | Event-time metric/check-in/health/lifecycle snapshots, Achieved versus explicit completion, category filters and one message per audit; injected queue failure rolls back mutation/audit; organization-aware links and unavailable-tenant recovery | Slack; affected Objectives / collaboration regression |
| SLACK-03 | Mocked transport response/redirect/429/503 handling, sanitized failures/retry, payload scrubbing, serialized concurrent claims permitting ordinary FK writes, inactive organization/pause/replacement/disconnect behavior | Slack; real Slack delivery remains unverified |
| SLACK-04 | Optional host key/retained EC2 key, replacement preservation and missing/invalid-key refusal, protected credential-free new release package; explicit channel audience guidance | Slack runtime tests; package safety/build logs; README |
| UI-01 | Unique lifecycle/health/overdue/active-score dashboard; explorer/My objectives combined filters, sorting/page size/date overlap; directory/notification URL state; collapsible filters preserve results; icon-only scopes and no card dates | Objectives / collaboration; Organizations; Platform |
| UI-02 | Full-page/shared graph panel controls, metric/history/check-in/comment/relationships/ownership/lifecycle sections; conflicts reload, readonly roles, empty and revoked-membership recovery, offline retry and not-found | Objectives / collaboration; Foundation; Organizations; Platform |
| UI-03 | Desktop 1440 x 960 and Chromium mobile iPhone 13 viewport; route titles/skip link/focus, modal menu containment/Escape/restore, keyboard switching/section links/graph; overflow assertions and inspected screenshots | All browser suites; representative visual review |

| Additional PRD scope | Exercised acceptance behavior | Evidence |
| --- | --- | --- |
| Sections 3, 5: API/database authority | Role/tenant/version/cycle constraints exercised directly through APIs and database, independent of frontend; shared error envelopes and proxied OpenAPI UI | All backend suites; Foundation |
| Sections 5, 7: container runtime | All application images build/typecheck using Docker; new project/network/empty volume applies eight migrations; readiness; persisted record survives database restart; migrations rerun without pending work | Build, clean migration, persistence and container restart logs |
| Sections 6, 7: onboarding/platform | Default signup disabled; trusted host command creates/promotes explicitly; invited accounts remain available; ordinary and platform tenant boundaries rechecked | Platform; Accounts; CLI and final runtime smoke; README |
| Section 7: production configuration | HTTPS/secure cookies/strong database secret and SMTP TLS/pairs validated; unsafe API/worker startup rejected; loopback overlay; unprivileged API/worker and log rotation; live query/header markers absent from access logs | Configuration unit tests; production script; container inspection/live log probe |
| Section 7: backup/recovery | Documented binary-safe dump/isolated restore; 20 table hashes, 30 rows/eight migrations, frozen score/history and correct alignment direction match; restore never used by API/worker | Restore drill and script logs |
| Section 7: account-mail operations | Self-hosted has no delivery; SMTP worker delivers verification/reset to Mailpit; invitation outbox is atomic; safe status diagnostics and exhausted retry budget/audit behavior | Accounts; Objectives / collaboration; mail status logs |
| Section 7: optional demo | No demo seed command is shipped or installed automatically. The explicit synthetic restore fixture refuses the live database and accepts only isolated chapter databases | Fresh startup observation; restore-drill source guard; README |

Coverage limits: Chromium desktop/mobile only; mobile is emulated, not a physical device. Representative keyboard, semantic, focus, geometry and screenshot checks are not formal WCAG certification. Graph snapshots and notification polling have no large-organization performance benchmark. External TLS certificates/proxy/monitoring, automatic retention, real disaster cutover and external production deployment remain operator work. Product exclusions in PRD section 2 remain excluded.
