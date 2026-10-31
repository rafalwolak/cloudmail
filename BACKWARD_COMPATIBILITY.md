# Cloudmail compatibility contracts

Cloudmail is early-stage; this policy protects existing documented behavior without claiming complete Resend compatibility. `README.md`, current route/tool implementations, and regression tests define supported behavior. Unsupported features must remain explicit.

| Protected surface | Source of truth | Breaking changes |
|---|---|---|
| Transactional HTTP API | `src/index.ts`, `src/email.ts`, `src/batch.ts`, `src/history.ts`, `src/metrics.ts`, `public/openapi.json`, `README.md` | Removing/changing routes or methods, required input fields, response fields/statuses, supported limits, pagination/filter semantics, idempotency, scheduling, or attachment behavior. |
| Templates, domains, inbound mail, keys, and webhooks | `src/templates.ts`, `src/domains.ts`, `src/inbound.ts`, `src/received-raw.ts`, `src/keys.ts`, `src/webhooks.ts` | Changing documented resource identities, published-template semantics, permission restrictions, deletion/replay behavior, or private content access, including signed raw-download scope, expiry and forced download headers. |
| MCP and discovery | `src/mcp.ts`, `src/discovery.ts`, `skills/cloudmail/SKILL.md` | Removing/renaming tools, incompatible argument/output schemas, changed discovery endpoints (including `/openapi.json` and the home `service-desc` link), or weaker permission/destructive-action annotations. |
| Authentication and administrator dashboard | `src/auth.ts`, `src/auth-config.ts`, `src/keys.ts`, `src/index.ts`, `public/dashboard.js` | Incompatible session/key formats, changed access scopes, removal of documented dashboard routes, or changes that invalidate integrations without migration. |
| Persisted D1/R2 data | `migrations/`, `src/scheduled.ts`, `src/sent-content.ts`, `src/inbound.ts`, `src/webhooks.ts` | Unreadable existing records/objects, changed reserved prefixes or payload snapshots, destructive migrations, loss of queued work/content, or broken cleanup references. |
| Events and webhook delivery | `src/delivery-events.ts`, `src/webhooks.ts`, `README.md` | Changed event names/payloads, signing headers/bytes, delivery IDs, retry/replay semantics, or accepted-versus-delivered meaning. |
| Installation/runtime configuration | `wrangler.jsonc`, `README.md`, `.dev.vars.example`, `src/auth-config.ts` | Renamed/removed bindings or variables, changed required configuration, or incompatible cron/queue/inbound setup. |
| Agent workflow configuration | `.ai/agentic.config.json`, `.ai/trackers/github.md`, `.ai/browsers/playwright.md` | Incompatible config schema/paths or descriptor operations that leave installed consumers unable to execute. |

## Required change path

Prefer additive changes that preserve old consumers. For a deliberate breaking change, identify affected consumers and stored data in the specification/PR, explain the need, document migration and rollback limits, add regression and consumer-facing integration tests, and obtain explicit maintainer approval before merge. Update `README.md`, relevant MCP/agent documentation, and this inventory when the supported contract changes.

Keep an old route, field, tool, or configuration alias during migration when feasible. Record an explicit maintainer-approved deprecation/removal plan in the PR; no fixed deprecation window has yet been established. A published incompatible release requires a major version increment; no release automation currently enforces this.

Never rewrite applied migrations. Add the next ordered migration and test upgrade from the existing schema on disposable data. Exercise rollback on disposable data or document why reversal is unsafe and provide a tested restore/forward-fix plan. Do not claim a down-migration exists when it does not. Preserve existing pending/scheduled work and webhook payload snapshots.

Auth restrictions, sending-only scope, private storage, uncertain send outcomes, and untrusted-content isolation are safety contracts. A compatibility change must not silently weaken them. Shared-contract changes receive high-risk review and must exercise the consuming API/MCP/browser side.

`src/` is application-internal TypeScript, not a separately published library API. There is no project-owned public CLI; the documented npm scripts and runtime configuration remain part of the installation workflow.
