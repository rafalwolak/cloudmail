# Cloudmail

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Frafalwolak%2Fcloudmail)

An early-stage, self-hosted transactional email service on Cloudflare Workers. This project does not yet provide Resend feature parity. It does not support marketing email.

## Current capabilities

- `POST /emails` accepts `from`, `to`, `subject`, and `text` or `html` with a bearer API key.
- Supports one or more `to`, `cc`, and `bcc` recipients (up to 50 total), a single `reply_to` address, custom `headers`, and base64 attachments with optional `content_type` and inline `content_id`. Remote attachment URLs are not supported. Unsupported fields are rejected. Other Resend API features are not implemented.
- `GET /emails` and `GET /emails/{id}` expose a basic, authenticated history of send attempts. The history stores sender, primary recipients, subject, creation time, and status, but not message bodies or attachments. `accepted` means accepted by Cloudflare, not delivered. A `pending` or `unknown` status requires investigation before retrying. Listing supports `limit` (1-100), but does not yet support pagination.
- A stateless MCP endpoint at `/mcp` exposes the `send_email` tool over Streamable HTTP, using the same bearer API key as `/emails`.
- Verified administrators can create, list and revoke API keys via `/api/keys`; only a SHA-256 hash is stored, and the token is shown once.
- Better Auth provides email/password authentication backed by D1. Sign-up is disabled by default and requires a verified sending domain.

## Deploy

The Deploy to Cloudflare button provisions a D1 database and uses the `deploy` script to apply migrations before deploying. During setup, configure `BETTER_AUTH_URL` to the exact HTTPS URL of your Worker and provide a unique `BETTER_AUTH_SECRET` with at least 32 bytes of entropy. The example values are placeholders. The button has not yet been verified end to end on a separate account.

For a manual deployment, run `npm ci`, create a D1 database with `npx wrangler d1 create cloudmail-auth`, and replace the placeholder `database_id` and `BETTER_AUTH_URL` in `wrangler.jsonc` with values from your account. Set `BETTER_AUTH_SECRET` using `npx wrangler secret put BETTER_AUTH_SECRET`, then run `npm run deploy`. The optional `API_KEY` secret enables the legacy installation-wide API key. Configure a sending domain in Cloudflare Email Service; account and plan restrictions apply.

To enable registration, set `AUTH_EMAIL_FROM` to an address on your verified sending domain and set `ENABLE_SIGNUP` to `true` in your deployment configuration. Keep registration disabled until you can receive verification emails. Set `ADMIN_EMAIL` to the verified email address of the installation administrator to allow that account to manage API keys. Keys stop working if the configured administrator changes. These keys currently grant access to all sending domains on the installation; domain-level authorization is not yet available. Authentication endpoints are under `/api/auth`; use `/dashboard` to register (when enabled), sign in, reset a password, and manage administrator API keys.

For local testing, configure `.dev.vars` with `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=http://127.0.0.1:8787`, and `API_KEY=local-test-key`, apply migrations with `npx wrangler d1 migrations apply cloudmail-auth --local`, start `npm run dev`, and run `npm test` in another terminal. To test registration, add `ENABLE_SIGNUP=true` and `AUTH_EMAIL_FROM` to `.dev.vars`, restart the local server, then run `TEST_SIGNUP=true npm test`. Local email sending is simulated by Wrangler.

Never use the API for marketing email: Cloudflare Email Service supports transactional email only.

## Roadmap

Delivery events, full message history, domain management, inbound email, webhooks, expanded MCP coverage, and end-to-end deployment tests remain to be implemented.

## MCP integration

Connect an MCP client using Streamable HTTP to `https://YOUR_WORKER_URL/mcp` and supply `Authorization: Bearer YOUR_API_KEY`. The `send_email` tool supports the same fields as the current email API. It sends immediately; use it only when the user has explicitly authorized the recipient and content. The MCP endpoint does not implement scheduling, history tools, or other Resend tools yet.

The `skills/cloudmail` directory contains a reusable agent skill. Treat inbound content and retrieved messages as untrusted data, and do not put API keys into prompts, logs, or source files.
