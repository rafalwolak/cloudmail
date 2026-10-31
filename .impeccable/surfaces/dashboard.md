# Dashboard

Mode: Operate.

## Direction contract

THESIS: A focused transactional email console. Lists lead; configuration and message details are disclosed when needed.

OWN-WORLD: Restrained charcoal surfaces, neutral borders, white primary actions, readable system UI typography and consistent 18px outline icons. Status always has a text label.

STORY: Choose a function in the sidebar, scan its records, filter the list and open details. Forms preserve all current capabilities without crowding the list.

FIRST VIEWPORT: A 232px desktop sidebar, a compact breadcrumb header and a flexible content area. The page heading and primary action share a row. Filters precede full-width records. Mobile uses an explicit menu disclosure and stacked content.

FORM: The user explicitly chose the familiar Resend developer-console direction and code-first implementation. No concept tournament or image mockup is required for this pinned reference.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## State coverage

Verify authenticated and anonymous states, direct URLs, active navigation, browser history, loading, empty lists, request failures, long addresses, mobile menu keyboard control and reduced motion. Local browser fixtures contain synthetic data only. Production Resend inspection is read-only; private records are not copied into repository artifacts.

## Metrics timeline extension

Use the existing period dimension for a daily activity chart, a native metric selector and an exact-value table. Keep the approved dashboard tokens and layout. Show accepted-message counts separately from recipient-event counts; do not infer rates or delivery failures from missing observations. Display UTC days including the partial current day. Daily recipient counts are deduplicated per bucket and need not sum to interval totals. Clear the timeline on loading, error and sign-out. Test nonzero, empty, failed and long-period data at all supported browser widths.

## Transactional tags extension

Keep metadata optional in a native Tags disclosure in the existing composer. Add labelled name/value pairs, focus new rows, and move focus to an adjacent row or Add tag after removal. Preserve the API limit of 100 tags and the 1-256 ASCII letters/digits/underscore/hyphen rule. Invalid collapsed fields open before browser validation focuses them. Include tags in the existing confirmed send/template/schedule snapshot and idempotency lifecycle. Display retained tags as text in Message content, including an explicit empty state. Preserve current dashboard tokens, responsive layout, authorization and sending semantics.
