# Resend attachment API adapter

## Objective

Support official Resend SDK attachment retrieval without changing the established binary attachment API or the dashboard/MCP downloads. Keep one storage and permission implementation, with an additive `/v1` representation adapter.

## Contract

- `/v1` delegates existing public REST resources (`emails`, `templates`, `domains`, `api-keys`, `webhooks`) to their existing handlers. It never aliases dashboard sessions, authentication, MCP, static assets or capability download routes. This does not claim complete Resend compatibility for those delegated resources.
- Sent and received attachment list/get operations return JSON metadata, opaque stable UUID attachment identifiers, `download_url` and `expires_at`. UUIDv8 identifiers encode a scoped digest and index; they are identifiers, not authorization. Cursors use those IDs within the parent message and direction.
- Received/sent details expose the same UUID attachment identifiers. Received `to` is an array in `/v1`; legacy fields and behavior are retained at unversioned routes.
- A download URL grants GET/HEAD for one attachment in one message/direction for one hour. It binds the installation origin, administrator and existing secret. Verify before storage access; force a private binary download with restrictive headers. Deletion/cancellation/configuration changes invalidate access; API-key revocation alone does not revoke issued capabilities.
- Share signing primitives with raw MIME downloads while preserving their existing payload, URL, five-minute lifetime and validation behavior exactly.
- Current bearer authentication and sending-only restrictions apply before metadata can be obtained. No extra Cloudflare tokens or public bucket. Missing signing configuration fails metadata retrieval explicitly.
- Keep unversioned binary endpoints, index identifiers, dashboard and MCP behavior unchanged. No migrations or stored attachment rewrites.
- Publish a generated `/v1/openapi.json` derived from the existing contract, with representations/cursors adapted and checked for drift in CI. Keep signing/validation libraries out of the Worker runtime where possible; use native Web Crypto.

## Verification

Exercise the real local Worker with the official Resend Node SDK: sending and receiving, metadata get/list, UUID stability, cursor directions, MIME/attachment bytes, scheduled cancellation, legacy binary access, denied scopes and namespace isolation. Test signature tampering/expiry/cross-resource/config changes before storage access and old raw-signature compatibility. Run both existing backend profiles and the full browser suite. Obtain fresh independent security review and API QA before merge/deployment. Use only synthetic local addresses/content; never print credentials, capability URLs or message bodies.
