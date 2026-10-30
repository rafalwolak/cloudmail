import type { AuthEnv } from './auth';
const types = new Set(['email.delivered', 'email.deferred', 'email.bounced', 'email.failed', 'email.rejected', 'email.complained']);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export function validWebhookUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value); const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash && !host.includes(':') && !/^[\d.]+$/.test(host) && host !== 'localhost' && !host.endsWith('.localhost') && !host.endsWith('.local') && host.includes('.');
  } catch { return false; }
}

export async function webhookHeaders(secret: string, id: string, timestamp: number, body: string): Promise<Record<string, string>> {
  const bytes = Uint8Array.from(atob(secret.slice(6)), char => char.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)));
  return { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': String(timestamp), 'svix-signature': `v1,${btoa(String.fromCharCode(...signature))}` };
}

export async function manageWebhooks(request: Request, env: AuthEnv): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === '/webhooks' && request.method === 'GET') {
    const rows = await env.DB.prepare('SELECT id, endpoint, events, created_at FROM webhooks ORDER BY created_at DESC, id DESC LIMIT 100').all<{ id: string; endpoint: string; events: string; created_at: string }>();
    return json({ object: 'list', data: rows.results.map(row => ({ ...row, events: JSON.parse(row.events) })) });
  }
  if (path === '/webhooks' && request.method === 'POST') {
    let body: unknown; try { body = await request.json(); } catch { return json({ message: 'Invalid JSON' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ message: 'Invalid webhook' }, 400);
    const value = body as Record<string, unknown>;
    if (Object.keys(value).some(key => !['endpoint', 'events'].includes(key)) || !validWebhookUrl(value.endpoint) || !Array.isArray(value.events) || !value.events.length || value.events.length > types.size || !value.events.every(event => typeof event === 'string' && types.has(event)) || new Set(value.events).size !== value.events.length) return json({ message: 'Invalid webhook' }, 400);
    const id = crypto.randomUUID(); const secret = 'whsec_' + btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    await env.DB.prepare('INSERT INTO webhooks (id, endpoint, events, signing_secret, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, value.endpoint, JSON.stringify(value.events), secret, new Date().toISOString()).run();
    return json({ object: 'webhook', id, signing_secret: secret }, 201);
  }
  const match = path.match(/^\/webhooks\/([0-9a-f-]{36})$/);
  if (!match) return json({ message: 'Not found' }, 404);
  if (request.method === 'GET') {
    const row = await env.DB.prepare('SELECT id, endpoint, events, created_at FROM webhooks WHERE id = ?').bind(match[1]).first<{ id: string; endpoint: string; events: string; created_at: string }>();
    return row ? json({ object: 'webhook', ...row, events: JSON.parse(row.events) }) : json({ message: 'Not found' }, 404);
  }
  if (request.method === 'DELETE') {
    const result = await env.DB.prepare('DELETE FROM webhooks WHERE id = ?').bind(match[1]).run();
    return result.meta.changes ? json({ object: 'webhook', id: match[1], deleted: true }) : json({ message: 'Not found' }, 404);
  }
  return json({ message: 'Not found' }, 404);
}

interface Pending { id: string; endpoint: string; signing_secret: string; event_id: string; type: string; recipient: string; occurred_at: string; details: string; provider_id: string; attempts: number }
export async function processWebhooks(env: AuthEnv): Promise<void> {
  const now = new Date().toISOString();
  const due = await env.DB.prepare("SELECT id FROM webhook_deliveries WHERE (state = 'pending' AND next_attempt <= ?) OR (state = 'sending' AND lease_until <= ?) ORDER BY next_attempt LIMIT 20").bind(now, now).all<{ id: string }>();
  for (const { id } of due.results) {
    const claimed = await env.DB.prepare("UPDATE webhook_deliveries SET state = 'sending', lease_until = ?, attempts = attempts + 1 WHERE id = ? AND ((state = 'pending' AND next_attempt <= ?) OR (state = 'sending' AND lease_until <= ?)) RETURNING attempts").bind(new Date(Date.now() + 60000).toISOString(), id, now, now).first<{ attempts: number }>();
    if (!claimed) continue;
    const row = await env.DB.prepare('SELECT d.id, d.attempts, w.endpoint, w.signing_secret, e.id AS event_id, e.type, e.recipient, e.occurred_at, e.details, e.provider_id FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id JOIN delivery_events e ON e.id = d.event_id WHERE d.id = ?').bind(id).first<Pending>();
    if (!row) continue;
    const email = await env.DB.prepare('SELECT id, sender, subject, created_at, tags FROM email_history WHERE provider_id = ?').bind(row.provider_id).first<{ id: string; sender: string; subject: string; created_at: string; tags: string }>();
    const payload = JSON.stringify({ type: `email.${row.type}`, created_at: row.occurred_at, data: { email_id: email?.id ?? null, from: email?.sender ?? null, to: [row.recipient], subject: email?.subject ?? null, tags: email ? JSON.parse(email.tags) : [], details: JSON.parse(row.details) } });
    let status: number | null = null;
    try {
      const headers = await webhookHeaders(row.signing_secret, `evt_${row.id}`, Math.floor(Date.now() / 1000), payload);
      const result = await fetch(row.endpoint, { method: 'POST', headers, body: payload, redirect: 'manual', signal: AbortSignal.timeout(5000) });
      status = result.status;
      await result.body?.cancel();
    } catch { /* Network failures are retried with the same event ID. */ }
    if (status !== null && status >= 200 && status < 300) {
      await env.DB.prepare("UPDATE webhook_deliveries SET state = 'delivered', last_status = ?, lease_until = NULL WHERE id = ? AND state = 'sending' AND attempts = ?").bind(status, id, row.attempts).run();
    } else {
      const state = row.attempts >= 8 ? 'failed' : 'pending';
      const next = new Date(Date.now() + Math.min(3600000, 60000 * 2 ** (row.attempts - 1))).toISOString();
      await env.DB.prepare('UPDATE webhook_deliveries SET state = ?, next_attempt = ?, last_status = ?, lease_until = NULL WHERE id = ? AND state = ? AND attempts = ?').bind(state, next, status, id, 'sending', row.attempts).run();
    }
  }
}
