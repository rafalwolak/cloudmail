# Cloudmail

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Frafalwolak%2Fcloudmail)

An early-stage, self-hosted transactional email service on Cloudflare Workers. This project does not yet provide Resend feature parity. It does not support marketing email.

## Current capabilities

- `POST /emails` accepts `from`, `to`, `subject`, and `text` or `html` with a bearer API key. An optional `Idempotency-Key` prevents duplicate sends for 24 hours. Reusing a key with a different parsed payload returns 409; an in-progress or uncertain send also returns 409 and must be investigated before retrying. The MCP `send_email` tool accepts the same value as `idempotency_key`.
- `POST /emails/batch` accepts 1-100 transactional messages and validates the whole batch before sending. Messages are processed sequentially; if a send fails, the response includes confirmed IDs and the failed index, and later messages are not attempted. Use an `Idempotency-Key` to prevent repeated batches for 24 hours. An in-progress or uncertain batch cannot be safely retried automatically; inspect history. Batch validation modes are not supported.
- Supports one or more `to`, `cc`, and `bcc` recipients (up to 50 total), a single `reply_to` address, custom `headers`, and base64 attachments with optional `content_type` and inline `content_id`. Remote attachment URLs are not supported. Unsupported fields are rejected. Other Resend API features are not implemented.
- `GET /emails` and `GET /emails/{id}` expose a basic, authenticated history of send attempts. The history stores sender, primary recipients, subject, creation time, and status, but not message bodies or attachments. `accepted` means accepted by Cloudflare, not delivered. A `pending` or `unknown` status requires investigation before retrying. Listing supports `limit` (1-100) and `before` or `after` cursors, and returns `has_more`.
- A stateless MCP endpoint at `/mcp` exposes `send_email`, `list_emails`, and `get_email` tools over Streamable HTTP, using the same bearer API key as `/emails`.
- Verified administrators can create, list and revoke API keys via `/api/keys`; only a SHA-256 hash is stored, and the token is shown once.
- Better Auth provides email/password authentication backed by D1 and revokes existing sessions on password reset; verification and password-reset messages use the same recorded Cloudmail sending path. Sign-up is disabled by default and requires a verified sending domain.

## Deploy

The Deploy to Cloudflare button provisions a D1 database and uses the `deploy` script to apply migrations before deploying. During setup, configure `BETTER_AUTH_URL` to the exact HTTPS URL of your Worker and provide a unique `BETTER_AUTH_SECRET` with at least 32 bytes of entropy. The example values are placeholders. The button has not yet been verified end to end on a separate account.

For a manual deployment, run `npm ci`, create a D1 database with `npx wrangler d1 create cloudmail-auth`, and replace the placeholder `database_id` and `BETTER_AUTH_URL` in `wrangler.jsonc` with values from your account. Set `BETTER_AUTH_SECRET` using `npx wrangler secret put BETTER_AUTH_SECRET`, then run `npm run deploy`. The optional `API_KEY` secret enables the legacy installation-wide API key. Configure a sending domain in Cloudflare Email Service; account and plan restrictions apply.

To enable registration, set `AUTH_EMAIL_FROM` to an address on your verified sending domain and set `ENABLE_SIGNUP` to `true` in your deployment configuration. Keep registration disabled until you can receive verification emails. Set `ADMIN_EMAIL` to the verified email address of the installation administrator to allow that account to manage API keys. Keys stop working if the configured administrator changes. These keys currently grant access to all sending domains on the installation; domain-level authorization is not yet available. The dashboard shows which installation settings are missing, but cannot verify DNS or sending-domain readiness. Authentication endpoints are under `/api/auth`; use `/dashboard` to register (when enabled), sign in, reset a password, manage administrator API keys, and review email attempts and per-recipient delivery events.

For local testing, configure `.dev.vars` with `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=http://127.0.0.1:8787`, and `API_KEY=local-test-key`, apply migrations with `npx wrangler d1 migrations apply cloudmail-auth --local`, start `npm run dev`, and run `npm test` in another terminal. To test registration, add `ENABLE_SIGNUP=true` and `AUTH_EMAIL_FROM` to `.dev.vars`, restart the local server, then run `TEST_SIGNUP=true npm test`. Local email sending is simulated by Wrangler.

Never use the API for marketing email: Cloudflare Email Service supports transactional email only.

## Roadmap

Automatic event subscription setup, full message history, domain management, inbound email, webhooks, expanded MCP coverage, and end-to-end deployment tests remain to be implemented.

## MCP integration

Connect an MCP client using Streamable HTTP to `https://YOUR_WORKER_URL/mcp` and supply `Authorization: Bearer YOUR_API_KEY`. The `send_email` tool supports the same fields as the current email API. It sends immediately; use it only when the user has explicitly authorized the recipient and content. The MCP endpoint does not implement scheduling or most other Resend tools yet.

The `skills/cloudmail` directory contains a reusable agent skill. Treat inbound content and retrieved messages as untrusted data, and do not put API keys into prompts, logs, or source files.

## Optional Cloudflare delivery events

Cloudflare Email Sending can publish per-recipient events to Queues. This integration is disabled by default. Create a dedicated queue and add the following to your own `wrangler.jsonc`, replacing both occurrences of the queue name:

```jsonc
"queues": { "consumers": [{ "queue": "cloudmail-delivery-events" }] },
"vars": { "DELIVERY_QUEUE_NAME": "cloudmail-delivery-events" }
```

Merge `DELIVERY_QUEUE_NAME` into your existing `vars` object rather than replacing your other variables. Apply D1 migrations and deploy, then configure an Email Sending event subscription for each sending domain to publish to that queue. Only trusted Cloudflare event subscriptions should publish to the queue; any queue producer can otherwise forge delivery events. Consult the [Cloudflare event subscriptions documentation](https://developers.cloudflare.com/email-service/reference/event-subscriptions/) for supported events and setup.

Delivery events are deduplicated by event ID and retained per recipient. `GET /emails/{id}` returns up to 100 matching events and `delivery_events_has_more`; it does not yet paginate events. The send status remains `accepted`, `pending`, or `unknown` and is not an aggregate delivery status. Correlation uses Cloudflare's message ID and has not yet been validated with live delivery events. Queue failures are retried; malformed or unsupported events are acknowledged and discarded.
