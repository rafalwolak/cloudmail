# Cloudmail code review

## Priorities

Review correctness, authorization, confidentiality, compatibility, and data integrity before style. Apply `AGENTS.md`, `BACKWARD_COMPATIBILITY.md`, and `SDLC.md`. Require narrow changes with understandable control flow, no speculative abstractions, and no unrelated cleanup.

## Repository-specific checks

- HTTP and MCP inputs: validate types, bounds, unsupported fields, and schemas consistently. Preserve status codes, response shapes, tool names, permission annotations, and sender restrictions across entry points.
- Authorization: exercise anonymous, non-administrator, unverified, sending-only, and wrong-owner/wrong-zone paths where relevant. Preserve origin checks and OAuth state/token protections. Never expose secrets or persist sensitive content into test artifacts.
- Sending: preserve idempotency conflicts, batch ordering and partial results, scheduling boundaries, cancellation cleanup, and the distinction between accepted and delivered. Do not automatically retry uncertain sends.
- D1/R2: native R2 stream uploads need a known length and workerd integration coverage beyond Node mocks. Use bound SQL parameters; preserve ordering and cursor semantics. Add ordered migrations, exercise them on disposable data, and document rollback and data-loss limits. Verify cleanup failure behavior and private attachment access.
- Webhooks/Queues: preserve signing bytes, delivery identity, saved payloads across retries/replays, leases, bounded retries, endpoint validation, and queue scoping. Treat responses and received content as untrusted.
- Templates/UI: preserve escaping, immutable published snapshots, and preview sandbox/CSP restrictions. Check accessible names, keyboard navigation, focus, contrast, loading/empty/error/permission states, long content, and narrow viewports against WCAG 2.2. When moving a form into a disclosure, test existing-record edit actions open it before focusing. Keep attempt status separate from the latest recipient event; one recipient event is not a whole-message delivery result.
- Performance: check bounded batch/query work, pagination, payload sizes, and unnecessary remote calls. Base optimizations on evidence.
- Browser validation: HTML `pattern` uses Unicode Sets (`v`) syntax; escape literal hyphens in character classes and exercise invalid inputs in a real browser.
- DOM edits: scope repeated construction snippets to their owning function and inspect the resulting diff; similar sent/inbound record builders must not receive each other's actions.
- Tests: native browser scenarios that use real local authentication or signed private downloads use a dedicated test file with top-level `test.use({ trace: 'off' })` (trace is worker-scoped and cannot be overridden inside a describe group) and avoid logging credentials in browser actions. Modules imported directly by the Node test runner use explicit `.ts` extensions for runtime imports. Add meaningful regression coverage for changed behavior using existing Node test and Miniflare patterns. Use Playwright for affected browser flows; distinguish manual exploration from committed E2E coverage. Scope label/text locators to the active form or page when hidden SPA screens repeat labels. Assert disabled states on interactive controls rather than fieldset containers.

## Validation and evidence

Run `npm run check`, then `npm test` against the intended disposable local Worker with local D1 migrations applied. Report commands, environment, failures, and skips. See `SDLC.md` for the setup-time failing baseline. GitHub Actions runs these commands for PRs to `main` through `.github/workflows/ci.yml`, using local migrations and a local Worker. No dedicated lint/build script exists. Run the dashboard browser suite with `npm run test:e2e` after the Worker tests; it uses synthetic API fixtures and does not replace authorization coverage. Never treat deployment as validation or claim missing checks passed.

## Findings and gates

- Blocker: credential disclosure, unauthorized access, data loss, broken protected contracts, failing required validation, or unresolved merge conflicts. Block approval.
- Major: incorrect behavior, missing meaningful regression coverage, or a user flow/accessibility failure. Request changes.
- Minor: localized maintainability or presentation issue with limited impact. State the concrete consequence and avoid unrelated rewrites.

A PR carries at most one pipeline label. Follow configured category, QA, priority, and risk labels. `needs-qa` requires current-head QA evidence and `qa-approved`; `blocked`, `do-not-merge`, active `qa`, and `qa-failed` block merge. High-risk auth, data-scoping, migration, and shared-contract changes require the evidence in `SDLC.md`. No self-QA for high-risk changes without an explicit maintainer exception; auth changes also require a second person's review. Never approve your own authoring work as independent review.
