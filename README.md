# Cloudmail

An early-stage, self-hosted transactional email service on Cloudflare Workers. This project does not yet provide Resend feature parity. It does not support marketing email.

## Current capabilities

- `POST /emails` accepts `from`, `to`, `subject`, and `text` or `html` with a bearer API key.
- The `to` field currently accepts one address. Other Resend API features are not implemented.

## Deploy

Install dependencies with `npm ci`, configure a sending domain in Cloudflare Email Service, and deploy with `npx wrangler deploy`. Set a long random `API_KEY` using `npx wrangler secret put API_KEY`. Cloudflare account and plan restrictions apply.

Never use the API for marketing email: Cloudflare Email Service supports transactional email only.

## Roadmap

Better Auth, user and API key management, persistent message logs, domain management, inbound email, webhooks, MCP, and automated tests remain to be implemented.
