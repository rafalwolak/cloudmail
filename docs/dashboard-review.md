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
