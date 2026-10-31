# Dashboard reference review

Reviewed on 2026-10-31. The user selected Resend as the reference and confirmed direct implementation in code.

## Evidence

Read-only inspection of the authenticated Resend dashboard covered Templates, Emails, Domains, a domain configuration view, Webhooks and Metrics. Inspection used the user's 615px in-app browser. Desktop behavior was verified in Cloudmail's local 1440px browser tests; Resend's desktop appearance was not directly inspected. No private Resend message bodies, credentials, account records or screenshots are included in this repository.

The reference uses compact page headings, clear primary actions, dedicated function URLs, searchable record lists, text status labels and contextual details. Templates expose publication status and preview cards. Email lists distinguish sending and receiving; domain details separate DNS records from configuration. Webhooks have endpoint lists and diagnostic detail. Metrics have period/domain controls and event-specific reporting.

Public references:

- [Sending emails](https://resend.com/docs/dashboard/emails/introduction)
- [Verified domains](https://resend.com/docs/dashboard/domains/introduction)
- [Webhooks](https://resend.com/docs/webhooks/introduction)

## Cloudmail implementation

Preserve the existing function URLs: overview, sent email, inbox, compose, templates, domains, metrics, API keys and webhooks. Keep the authenticated shell independent of the login layout. Use a desktop sidebar and an explicit mobile menu, compact message summaries, grouped filter fields and disclosed configuration forms. Request data for the visible function rather than serially loading every integration at sign-in. Keep failures within their function.

Do not imply parity by displaying inactive features. Resend's marketing workflows remain outside Cloudmail's transactional-only scope. The redesign does not implement new backend features such as open/click tracking, API request logs, template folders or richer analytics.

## Verification limits

Playwright exercises real local dashboard assets and Worker page routing, with synthetic API responses for administrator UI scenarios. It covers direct URLs, navigation/history, focus, mobile menu, request errors, empty lists, literal untrusted subjects, scheduled controls and overflow at 1440px, 615px and 390px. It does not authenticate a real administrator, send real mail, grant Cloudflare access or certify complete WCAG conformance. Worker tests separately cover authorization and HTTP contracts; optional credential-dependent scenarios remain skipped when fixtures are absent.

## Inbox original download review

The narrow Inbox extension keeps the approved Reply placement and adds Download .eml as a secondary action in the same wrapping row. The source reuses existing button, spacing, focus and status treatments; no new design tokens or global visual rules are introduced. `DESIGN.md` and `.impeccable/design.json` remain unchanged. The signed capability is refreshed per click, fetched without credentials or a referrer, and never inserted into the DOM. Loading uses a disabled Downloading… action and status text without a spinner. Failure and unavailable states restore the action; navigation, sign-out and inbox reset abort pending requests.

The finish review inspected nine synthetic Playwright captures covering ready, loading and recoverable error at 1440px, 615px and 390px. Its disposition was ship, with no material fixes. The two author capture passes were complete before documentation. The pinned incumbent comparison remains `docs/screenshots/reply-inbox*.png`; no generated image mockup was used. Shipping screenshot provenance is embedded in these PNGs:

- [Desktop ready state](screenshots/inbox-original-desktop.png): 1440px viewport.
- [Mobile ready state](screenshots/inbox-original-mobile.png): 390px viewport.
- [User-width ready state](screenshots/inbox-original-user-615.png): 615px viewport.
- [Mobile recoverable error](screenshots/inbox-original-error-mobile.png): 390px viewport.

The implementation review reported 18 passing new cases. The completed validation gate reported 105 passing Playwright cases and 185 passing backend tests, with 16 optional profile-dependent tests skipped. Relevant committed browser coverage verifies keyboard activation, exact downloaded MIME bytes, fresh capabilities, no signed URL links, loading/retry, unavailable configuration, foreign URL rejection and cancellation. These results use local assets and synthetic API responses; they do not establish real administrator authentication, production mail delivery or full WCAG conformance. No unrelated design drift is promoted into the canonical system by this extension.

The dedicated `test/e2e/inbox-native.spec.ts` additionally verifies the original-download flow against real local Better Auth sign-in/session, Email Routing and R2 at all three viewports. It uses synthetic messages and a disposable administrator, disables failure tracing, and deletes its message fixture. It does not send external email or validate production routing. The other 105 view-state cases continue to use synthetic API responses.
