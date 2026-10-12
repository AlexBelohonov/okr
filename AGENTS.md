# Repository Working Instructions

## Start or Resume

Read PRD.md, DEVELOPMENT.md, PROGRESS.md, and the latest entry in REVIEWS.md before making changes. Inspect the actual workspace to confirm the ledger is current. Preserve user changes and earlier product decisions unless the user changes them.

The application is being delivered in chapters. Follow the current review policy in PROGRESS.md. Default: complete one chapter, verify it, record a reviewable revision, and stop for user review. A user instruction to continue authorizes the next chapter and required fixes. Continuous development is allowed when the user selects it.

## Implementation

- Docker Compose is the main runtime. Use docker-compose.yml; host Node is not a prerequisite.
- Tenant isolation, role checks, version conflicts, audit atomicity, and cycle detection are API/database responsibilities, not frontend-only checks.
- PRD describes the target, not proof of implementation. Scaffolding and unverified files must not be counted as delivered requirements.
- Use apply_patch for manual edits. Keep ownership boundaries and existing changes intact.
- Test each chapter's meaningful behavior and rerun affected checks when review revisions change behavior. Use the real first-party API for E2E tests.
- Update PRD when behavior changes; update PROGRESS with verified status and exact next action; append review evidence and decisions to REVIEWS.

## Pausing

On pause, stop initiating new work and record changed files, unfinished tasks, running processes/services, tests and results, unresolved decisions, and exact next action. Preserve work. Do not claim tests or review acceptance that did not occur. On resume, continue from the recorded checkpoint instead of recreating the project.
