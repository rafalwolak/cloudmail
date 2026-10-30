import { createAuth, type AuthEnv } from './auth';
import { allowedSender, parseEmail } from './email';
import { handleMcp } from './mcp';
import { sendBatch } from './batch';
import { manageSchedule, processScheduled, scheduleEmail, validateSchedule } from './scheduled';
import { handleTemplates, resolveTemplate } from './templates';
import { processDeliveryBatch } from './delivery-events';
import { IdempotencyConflict, readHistory, sendRecordedEmail } from './history';
import { authorizeAdmin, findKeyOwner, handleKeyResources, keyPermission, manageKeys, type KeyEnv } from './keys';

interface Env extends AuthEnv, KeyEnv { API_KEY: string; ASSETS: Fetcher; DELIVERY_QUEUE_NAME?: string }

const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cloudmail - transactional email on Cloudflare</title><style>body{margin:0;background:#101613;color:#f2f4ec;font:16px system-ui}main{max-width:1000px;margin:auto;padding:36px 24px}nav{display:flex;justify-content:space-between;align-items:center}a{color:#c0efa0}header{padding:110px 0 80px}h1{font-size:clamp(48px,8vw,100px);line-height:.98;letter-spacing:-.06em;max-width:800px;margin:22px 0}p{line-height:1.7;color:#b9c5b8;max-width:620px}.tag{color:#b9ec94;font-size:13px;letter-spacing:.12em;text-transform:uppercase}section{border-top:1px solid #39443c;padding:35px 0}code{color:#b9ec94}footer{padding:60px 0;color:#9aab9c}</style></head><body><main><nav><strong>✳ CLOUDMAIL</strong><a href="/dashboard">Dashboard ↗</a></nav><header><span class="tag">Open source · Cloudflare native</span><h1>Email, on your own terms.</h1><p>A self-hosted foundation for transactional email. Built for developers who want a simple API and infrastructure they control.</p></header><section><span class="tag">Early development</span><h2>Built in the open.</h2><p>Cloudmail is under active development. Email sending requires a verified Cloudflare sending domain and an API key. Sign in to manage your API keys in the dashboard.</p><p>API endpoint: <code>POST /emails</code></p></section><footer>Cloudmail · Transactional email only</footer></main></body></html>`;

export default {
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> { await processScheduled(env); },
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    if (!env.DELIVERY_QUEUE_NAME || batch.queue !== env.DELIVERY_QUEUE_NAME) { batch.retryAll(); return; }
    await processDeliveryBatch(batch, env.DB);
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/setup' && request.method === 'GET') {
      const authentication = Boolean(env.BETTER_AUTH_SECRET && env.BETTER_AUTH_URL && env.BETTER_AUTH_URL !== 'https://example.com');
      const sender = Boolean(env.AUTH_EMAIL_FROM);
      return Response.json({ authentication_configured: authentication, sender_configured: sender, registration_enabled: authentication && sender && env.ENABLE_SIGNUP === 'true', administrator_configured: Boolean(env.ADMIN_EMAIL), sending_domain_status: 'unknown' }, { headers: { 'cache-control': 'no-store' } });
    }
    if (url.pathname.startsWith('/api/auth/')) {
      if (!env.BETTER_AUTH_SECRET || !env.BETTER_AUTH_URL) return Response.json({ message: 'Authentication is not configured' }, { status: 503 });
      return createAuth(env).handler(request);
    }
    if (url.pathname === '/api/keys' || url.pathname.startsWith('/api/keys/')) return manageKeys(request, env);
    if (url.pathname === '/api/history' || url.pathname.startsWith('/api/history/')) {
      const admin = await authorizeAdmin(request, env);
      if (admin instanceof Response) return admin;
      if (request.method !== 'GET' && request.headers.get('origin') !== new URL(env.BETTER_AUTH_URL).origin) return Response.json({ message: 'Invalid origin' }, { status: 403 });
      url.pathname = '/emails' + url.pathname.slice('/api/history'.length);
      return request.method === 'GET' ? readHistory(new Request(url), env) : manageSchedule(new Request(url, request), env);
    }
    if (url.pathname === '/api/templates' || url.pathname.startsWith('/api/templates/')) {
      const admin = await authorizeAdmin(request, env);
      if (admin instanceof Response) return admin;
      if (request.method !== 'GET' && request.headers.get('origin') !== new URL(env.BETTER_AUTH_URL).origin) return Response.json({ message: 'Invalid origin' }, { status: 403 });
      url.pathname = '/templates' + url.pathname.slice('/api/templates'.length);
      return handleTemplates(new Request(url, request), env);
    }
    if (request.method === 'GET' && ['/dashboard', '/dashboard.js', '/dashboard.css'].includes(url.pathname)) {
      const path = url.pathname === '/dashboard' ? '/dashboard.html' : url.pathname;
      const response = await env.ASSETS.fetch(new Request(new URL(path, url), request));
      const headers = new Headers(response.headers);
      headers.set('content-security-policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      headers.set('x-content-type-options', 'nosniff');
      headers.set('referrer-policy', 'no-referrer');
      headers.set('cache-control', 'no-store');
      return new Response(response.body, { status: response.status, headers });
    }
    if (url.pathname === '/' && request.method === 'GET') return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'", 'x-content-type-options': 'nosniff' } });
    if (url.pathname !== '/mcp' && !(url.pathname === '/api-keys' || url.pathname.startsWith('/api-keys/')) && !(url.pathname === '/templates' || url.pathname.startsWith('/templates/')) && !(url.pathname === '/emails/batch' && request.method === 'POST') && !(url.pathname === '/emails' && ['GET', 'POST'].includes(request.method)) && !(url.pathname.startsWith('/emails/') && ['GET', 'PATCH', 'POST'].includes(request.method))) return Response.json({ message: 'Not found' }, { status: 404 });
    const authorization = request.headers.get('Authorization') || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const access = env.API_KEY && token === env.API_KEY ? { permission: 'full_access' as const, sending_domain: null } : await keyPermission(env.DB, token, env.ADMIN_EMAIL);
    if (!access) return Response.json({ message: 'Unauthorized' }, { status: 401 });
    if (access.permission === 'sending_access' && url.pathname !== '/mcp' && !(request.method === 'POST' && (url.pathname === '/emails' || url.pathname === '/emails/batch'))) return Response.json({ message: 'Forbidden' }, { status: 403 });
    if (url.pathname === '/mcp') return handleMcp(request, env, access);
    if (url.pathname === '/api-keys' || url.pathname.startsWith('/api-keys/')) {
      const owner = await findKeyOwner(env);
      if (!owner) return Response.json({ message: 'Verified administrator is not configured' }, { status: 503 });
      return handleKeyResources(request, env, owner.id);
    }
    if (url.pathname === '/templates' || url.pathname.startsWith('/templates/')) return handleTemplates(request, env);
    if (url.pathname === '/emails/batch' && request.method === 'POST') return sendBatch(request, env, access.sending_domain);
    if (request.method === 'GET') return readHistory(request, env);
    if (url.pathname.startsWith('/emails/')) return manageSchedule(request, env);
    let data: unknown;
    try { data = await request.json(); } catch { return Response.json({ message: 'Invalid JSON' }, { status: 400 }); }
    let scheduledAt: string | undefined;
    if (data && typeof data === 'object' && !Array.isArray(data) && 'scheduled_at' in data) {
      scheduledAt = validateSchedule((data as Record<string, unknown>).scheduled_at) ?? undefined;
      if (!scheduledAt) return Response.json({ message: 'scheduled_at must be an ISO 8601 time within 30 days' }, { status: 400 });
      const { scheduled_at: _scheduledAt, ...rest } = data as Record<string, unknown>; data = rest;
    }
    const resolved = await resolveTemplate(data, env);
    if (typeof resolved === 'string') return Response.json({ message: resolved }, { status: 400 });
    const email = parseEmail(resolved);
    if (typeof email === 'string') return Response.json({ message: email }, { status: 400 });
    if (!allowedSender(email, access.sending_domain)) return Response.json({ message: 'Sender is not permitted for this key' }, { status: 403 });
    const idempotencyKey = request.headers.get('Idempotency-Key');
    if (idempotencyKey !== null && (idempotencyKey.length < 1 || idempotencyKey.length > 256)) return Response.json({ message: 'Idempotency-Key must be 1-256 characters', name: 'invalid_idempotency_key' }, { status: 400 });
    try {
      const result = scheduledAt ? await scheduleEmail(env, email, scheduledAt, idempotencyKey ?? undefined) : await sendRecordedEmail(env, email, idempotencyKey ?? undefined);
      return Response.json(result);
    } catch (error) {
      if (error instanceof IdempotencyConflict) return Response.json({ message: error.code, name: error.code }, { status: 409 });
      return Response.json({ message: 'Email could not be confirmed. Check history before retrying; delivery may be uncertain.' }, { status: 502 });
    }
  }
};
