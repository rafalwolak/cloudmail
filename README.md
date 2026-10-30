# Cloudmail

An early-stage, self-hosted transactional email service on Cloudflare Workers. This project does not yet provide Resend feature parity. It does not support marketing email.

## Current capabilities

- `POST /emails` accepts `from`, `to`, `subject`, and `text` or `html` with a bearer API key.
- Supports one or more `to`, `cc`, and `bcc` recipients (up to 50 total), a single `reply_to` address, custom `headers`, and base64 attachments with optional `content_type` and inline `content_id`. Remote attachment URLs are not supported. Unsupported fields are rejected. Other Resend API features are not implemented.
- Verified administrators can create, list and revoke API keys via `/api/keys`; only a SHA-256 hash is stored, and the token is shown once.
- Better Auth provides email/password authentication backed by D1. Sign-up is disabled by default and requires a verified sending domain.

## Deploy

Install dependencies with `npm ci`, configure a sending domain in Cloudflare Email Service, and deploy with `npx wrangler deploy`. Set a long random `API_KEY` using `npx wrangler secret put API_KEY`. Cloudflare account and plan restrictions apply.

Configure `BETTER_AUTH_URL` for your own deployment and replace the D1 database ID in `wrangler.jsonc` with one from your account. Apply migrations with `npx wrangler d1 migrations apply cloudmail-auth --remote` and set `BETTER_AUTH_SECRET` using `npx wrangler secret put BETTER_AUTH_SECRET`. Use a unique random secret with at least 32 bytes of entropy. To enable registration, set `AUTH_EMAIL_FROM` to an address on your verified sending domain and set `ENABLE_SIGNUP` to `true` in your deployment configuration. Keep registration disabled until you can receive verification emails. Set `ADMIN_EMAIL` to the verified email address of the installation administrator to allow that account to manage API keys. Keys stop working if the configured administrator changes. These keys currently grant access to all sending domains on the installation; domain-level authorization is not yet available. Authentication endpoints are under `/api/auth`; use `/dashboard` to sign in and manage administrator API keys.

For local testing, configure `.dev.vars` with `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=http://127.0.0.1:8787`, and `API_KEY=local-test-key`, apply migrations with `npx wrangler d1 migrations apply cloudmail-auth --local`, start `npm run dev`, and run `npm test` in another terminal. To test registration, add `ENABLE_SIGNUP=true` and `AUTH_EMAIL_FROM` to `.dev.vars`, restart the local server, then run `TEST_SIGNUP=true npm test`. Local email sending is simulated by Wrangler.

Never use the API for marketing email: Cloudflare Email Service supports transactional email only.

## Roadmap

User and API key management, persistent message logs, domain management, inbound email, webhooks, MCP, and automated tests remain to be implemented.
