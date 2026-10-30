import type { AuthEnv } from './auth';
const types = new Set(['email.sent', 'email.received', 'email.delivered', 'email.deferred', 'email.delivery_delayed', 'email.bounced', 'email.failed', 'email.rejected', 'email.complained']);
const validEvents = (events: unknown): events is string[] => Array.isArray(events) && events.length > 0 && events.length <= types.size && events.every(event => typeof event === 'string' && types.has(event)) && new Set(events).size === events.length;
const newSecret = () => 'whsec_' + btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function readWebhookResponse(body: ReadableStream<Uint8Array> | null): Promise<{ text: string; truncated: boolean }> {
  if (!body) return { text: '', truncated: false };
  const reader = body.getReader(); const decoder = new TextDecoder(); let text = ''; let size = 0;
  try {
    while (size < 4096) {
      const part = await reader.read();
      if (part.done) return { text: text + decoder.decode(), truncated: false };
      const bytes = part.value.subarray(0, 4096 - size); size += bytes.length; text += decoder.decode(bytes, { stream: true });
    }
    return { text: text + decoder.decode(), truncated: true };
  } finally { void reader.cancel().catch(() => {}); }
}

export function validWebhookUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value); const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash && !host.includes(':') && !/^[\d.]+$/.test(host) && host !== 'localhost' && !host.endsWith('.localhost') && !host.endsWith('.local') && host.includes('.');
  } catch { return false; }
}

export async function webhookHeaders(secret: string, id: string, timestamp: number, body: string, previousSecret?: string): Promise<Record<string, string>> {
  const sign = async (value: string) => {
    const bytes = Uint8Array.from(atob(value.slice(6)), char => char.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)));
    return `v1,${btoa(String.fromCharCode(...signature))}`;
  };
  const signatures = await Promise.all([sign(secret), ...(previousSecret ? [sign(previousSecret)] : [])]);
  return { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': String(timestamp), 'svix-signature': signatures.join(' ') };
}

export async function manageWebhooks(request: Request, env: AuthEnv): Promise<Response> {
  const path = new URL(request.url).pathname;
  const eventReplay = path.match(/^\/webhooks\/([0-9a-f-]{36})\/events\/([0-9a-f]{32})\/replay$/);
  if (eventReplay && request.method === 'POST') {
    if (new URL(request.url).search) return json({ message: 'Unsupported query parameter' }, 400);
    const result = await env.DB.prepare("UPDATE webhook_deliveries SET state = 'pending', next_attempt = ?, lease_until = NULL, manual_once = 1 WHERE webhook_id = ? AND id = ? AND state IN ('delivered', 'failed') AND payload IS NOT NULL AND EXISTS (SELECT 1 FROM webhooks WHERE id = webhook_id AND status = 'enabled')").bind(new Date().toISOString(), eventReplay[1], eventReplay[2]).run();
    if (result.meta.changes) return json({ object: 'webhook_event', id: eventReplay[2] });
    const existing = await env.DB.prepare('SELECT d.id, d.payload, w.status FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id WHERE d.webhook_id = ? AND d.id = ?').bind(eventReplay[1], eventReplay[2]).first<{ id: string; payload: string | null; status: string }>();
    return existing ? json({ message: existing.status === 'disabled' ? 'Webhook is disabled' : existing.payload === null ? 'Event payload is unavailable' : 'Event delivery is already pending or in progress' }, existing.status === 'disabled' || existing.payload === null ? 422 : 409) : json({ message: 'Not found' }, 404);
  }
  const eventAttempts = path.match(/^\/webhooks\/([0-9a-f-]{36})\/events\/([0-9a-f]{32})\/attempts$/);
  if (eventAttempts && request.method === 'GET') {
    const params = new URL(request.url).searchParams; const raw = params.get('limit') ?? '20'; const after = params.get('after');
    if ([...params.keys()].some(key => !['limit', 'after'].includes(key)) || ['limit', 'after'].some(key => params.getAll(key).length > 1) || !/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 100) return json({ message: 'Invalid pagination' }, 400);
    const delivery = await env.DB.prepare('SELECT id FROM webhook_deliveries WHERE webhook_id = ? AND id = ?').bind(eventAttempts[1], eventAttempts[2]).first();
    if (!delivery) return json({ message: 'Not found' }, 404);
    let before = 2147483647;
    if (after !== null) {
      const cursor = after.match(/^atmpt_([0-9a-f]{32})_([1-9][0-9]{0,8})$/);
      if (!cursor || cursor[1] !== eventAttempts[2]) return json({ message: 'Invalid cursor' }, 400);
      before = Number(cursor[2]);
      const anchor = await env.DB.prepare('SELECT attempt_number FROM webhook_attempts WHERE delivery_id = ? AND attempt_number = ?').bind(eventAttempts[2], before).first();
      if (!anchor) return json({ message: 'Invalid cursor' }, 400);
    }
    const limit = Number(raw);
    const rows = await env.DB.prepare('SELECT attempt_number, attempted_at, status, error, response, response_truncated FROM webhook_attempts WHERE delivery_id = ? AND attempt_number < ? ORDER BY attempt_number DESC LIMIT ?').bind(eventAttempts[2], before, limit + 1).all<{ attempt_number: number; attempted_at: string; status: number | null; error: string | null; response: string | null; response_truncated: number }>();
    return json({ object: 'list', has_more: rows.results.length > limit, data: rows.results.slice(0, limit).map(row => ({ id: `atmpt_${eventAttempts[2]}_${row.attempt_number}`, http_status_code: row.status, response: row.response, response_truncated: Boolean(row.response_truncated), sent_at: row.attempted_at, error: row.error })) });
  }
  const eventsPath = path.match(/^\/webhooks\/([0-9a-f-]{36})\/events(?:\/([0-9a-f]{32}))?$/);
  if (eventsPath && request.method === 'GET') {
    const url = new URL(request.url);
    url.pathname = `/webhooks/${eventsPath[1]}/deliveries${eventsPath[2] ? `/${eventsPath[2]}` : ''}`;
    const response = await manageWebhooks(new Request(url, request), env);
    if (!response.ok) return response;
    type Delivery = { id: string; event_type: string; occurred_at: string; state: string; next_attempt: string | null; payload: unknown };
    const status = (state: string) => state === 'sending' ? 'attempting' : state === 'delivered' ? 'success' : state;
    const format = (item: Delivery) => ({ id: item.id, type: item.event_type, created_at: item.occurred_at, status: status(item.state) });
    if (eventsPath[2]) {
      const item = await response.json() as Delivery;
      return json({ object: 'webhook_event', ...format(item), next_attempt_at: item.state === 'pending' ? item.next_attempt : null, payload: item.payload });
    }
    const list = await response.json() as { data: Delivery[]; has_more: boolean };
    return json({ object: 'list', has_more: list.has_more, data: list.data.map(format) });
  }
  if (path === '/webhooks' && request.method === 'GET') {
    const params = new URL(request.url).searchParams; const raw = params.get('limit') ?? '100'; const after = params.get('after'); const before = params.get('before');
    if ([...params.keys()].some(key => !['limit', 'after', 'before'].includes(key)) || ['limit', 'after', 'before'].some(key => params.getAll(key).length > 1) || !/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 100 || (after !== null && before !== null) || after === '' || before === '') return json({ message: 'Invalid pagination' }, 400);
    const cursor = after ?? before; let anchor: { id: string; created_at: string } | null = null;
    if (cursor !== null) {
      anchor = await env.DB.prepare('SELECT id, created_at FROM webhooks WHERE id = ?').bind(cursor).first<{ id: string; created_at: string }>();
      if (!anchor) return json({ message: 'Invalid cursor' }, 400);
    }
    const direction = before !== null ? 'ASC' : 'DESC';
    const condition = anchor ? `WHERE (created_at, id) ${before !== null ? '>' : '<'} (?, ?)` : '';
    const rows = await env.DB.prepare(`SELECT id, endpoint, events, status, created_at FROM webhooks ${condition} ORDER BY created_at ${direction}, id ${direction} LIMIT ?`).bind(...(anchor ? [anchor.created_at, anchor.id] : []), Number(raw) + 1).all<{ id: string; endpoint: string; events: string; status: string; created_at: string }>();
    const page = rows.results.slice(0, Number(raw)); if (before !== null) page.reverse();
    return json({ object: 'list', has_more: rows.results.length > Number(raw), data: page.map(row => ({ ...row, events: JSON.parse(row.events) })) });
  }
  if (path === '/webhooks' && request.method === 'POST') {
    let body: unknown; try { body = await request.json(); } catch { return json({ message: 'Invalid JSON' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ message: 'Invalid webhook' }, 400);
    const value = body as Record<string, unknown>;
    if (Object.keys(value).some(key => !['endpoint', 'events'].includes(key)) || !validWebhookUrl(value.endpoint) || !validEvents(value.events)) return json({ message: 'Invalid webhook' }, 400);
    const id = crypto.randomUUID(); const secret = newSecret();
    await env.DB.prepare('INSERT INTO webhooks (id, endpoint, events, signing_secret, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, value.endpoint, JSON.stringify(value.events), secret, new Date().toISOString()).run();
    return json({ object: 'webhook', id, signing_secret: secret }, 201);
  }
  const rotation = path.match(/^\/webhooks\/([0-9a-f-]{36})\/rotate-secret$/);
  if (rotation && request.method === 'POST') {
    const now = new Date().toISOString(); const expires = new Date(Date.now() + 86400000).toISOString(); const secret = newSecret();
    const result = await env.DB.prepare('UPDATE webhooks SET previous_secret = signing_secret, previous_secret_expires_at = ?, signing_secret = ? WHERE id = ? AND (previous_secret_expires_at IS NULL OR previous_secret_expires_at <= ?)').bind(expires, secret, rotation[1], now).run();
    if (!result.meta.changes) {
      const existing = await env.DB.prepare('SELECT id FROM webhooks WHERE id = ?').bind(rotation[1]).first();
      return json({ message: existing ? 'Secret rotation already in progress' : 'Not found' }, existing ? 409 : 404);
    }
    return json({ object: 'webhook', id: rotation[1], signing_secret: secret, previous_secret_expires_at: expires });
  }
  const replay = path.match(/^\/webhooks\/([0-9a-f-]{36})\/deliveries\/([0-9a-f]{32})\/replay$/);
  if (replay && request.method === 'POST') {
    const id = crypto.randomUUID().replaceAll('-', '');
    const result = await env.DB.prepare("INSERT INTO webhook_deliveries (id, webhook_id, event_id, next_attempt, replay_of, payload, event_type) SELECT ?, webhook_id, event_id, ?, id, payload, event_type FROM webhook_deliveries WHERE webhook_id = ? AND id = ? AND EXISTS (SELECT 1 FROM webhooks WHERE id = webhook_id AND status = 'enabled')").bind(id, new Date().toISOString(), replay[1], replay[2]).run();
    return result.meta.changes ? json({ id, replay_of: replay[2] }, 201) : json({ message: 'Not found' }, 404);
  }
  const deliveryDetail = path.match(/^\/webhooks\/([0-9a-f-]{36})\/deliveries\/([0-9a-f]{32})$/);
  if (deliveryDetail && request.method === 'GET') {
    if ([...new URL(request.url).searchParams.keys()].length) return json({ message: 'Unsupported query parameter' }, 400);
    const row = await env.DB.prepare("SELECT d.id, d.event_id, d.state, d.attempts, d.next_attempt, d.last_status, d.replay_of, d.payload, e.type, COALESCE(d.event_type, 'email.' || e.type) AS event_type, e.occurred_at FROM webhook_deliveries d JOIN delivery_events e ON e.id = d.event_id WHERE d.webhook_id = ? AND d.id = ?").bind(deliveryDetail[1], deliveryDetail[2]).first<{ payload: string | null } & Record<string, unknown>>();
    return row ? json({ object: 'webhook_delivery', ...row, payload: row.payload === null ? null : JSON.parse(row.payload) }) : json({ message: 'Not found' }, 404);
  }
  const attempts = path.match(/^\/webhooks\/([0-9a-f-]{36})\/deliveries\/([0-9a-f]{32})\/attempts$/);
  if (attempts && request.method === 'GET') {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].length) return json({ message: 'Unsupported query parameter' }, 400);
    const delivery = await env.DB.prepare('SELECT id FROM webhook_deliveries WHERE webhook_id = ? AND id = ?').bind(attempts[1], attempts[2]).first();
    if (!delivery) return json({ message: 'Not found' }, 404);
    const rows = await env.DB.prepare('SELECT attempt_number, attempted_at, status, error, response, response_truncated FROM webhook_attempts WHERE delivery_id = ? ORDER BY attempt_number DESC').bind(attempts[2]).all();
    return json({ object: 'list', data: rows.results });
  }
  const deliveries = path.match(/^\/webhooks\/([0-9a-f-]{36})\/deliveries$/);
  if (deliveries && request.method === 'GET') {
    const params = new URL(request.url).searchParams; const raw = params.get('limit') ?? '20'; const after = params.get('after');
    if ([...params.keys()].some(key => !['limit', 'after'].includes(key)) || ['limit', 'after'].some(key => params.getAll(key).length > 1) || !/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 100 || after === '') return json({ message: 'Invalid pagination' }, 400);
    const webhook = await env.DB.prepare('SELECT id FROM webhooks WHERE id = ?').bind(deliveries[1]).first();
    if (!webhook) return json({ message: 'Not found' }, 404);
    let condition = ''; let values: string[] = [];
    if (after !== null) {
      const anchor = await env.DB.prepare('SELECT d.id, e.occurred_at FROM webhook_deliveries d JOIN delivery_events e ON e.id = d.event_id WHERE d.webhook_id = ? AND d.id = ?').bind(deliveries[1], after).first<{ id: string; occurred_at: string }>();
      if (!anchor) return json({ message: 'Invalid cursor' }, 400);
      condition = 'AND (e.occurred_at, d.id) < (?, ?)'; values = [anchor.occurred_at, anchor.id];
    }
    const limit = Number(raw);
    const rows = await env.DB.prepare(`SELECT d.id, d.event_id, d.state, d.attempts, d.next_attempt, d.last_status, d.replay_of, e.type, COALESCE(d.event_type, 'email.' || e.type) AS event_type, e.occurred_at FROM webhook_deliveries d JOIN delivery_events e ON e.id = d.event_id WHERE d.webhook_id = ? ${condition} ORDER BY e.occurred_at DESC, d.id DESC LIMIT ?`).bind(deliveries[1], ...values, limit + 1).all();
    return json({ object: 'list', data: rows.results.slice(0, limit), has_more: rows.results.length > limit });
  }
  const match = path.match(/^\/webhooks\/([0-9a-f-]{36})$/);
  if (!match) return json({ message: 'Not found' }, 404);
  if (request.method === 'GET') {
    const row = await env.DB.prepare('SELECT id, endpoint, events, status, created_at FROM webhooks WHERE id = ?').bind(match[1]).first<{ id: string; endpoint: string; events: string; status: string; created_at: string }>();
    return row ? json({ object: 'webhook', ...row, events: JSON.parse(row.events) }) : json({ message: 'Not found' }, 404);
  }
  if (request.method === 'PATCH') {
    let body: unknown; try { body = await request.json(); } catch { return json({ message: 'Invalid JSON' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ message: 'Invalid webhook' }, 400);
    const value = body as Record<string, unknown>;
    if (!Object.keys(value).length || Object.keys(value).some(key => !['endpoint', 'events', 'status'].includes(key)) || (value.endpoint !== undefined && !validWebhookUrl(value.endpoint)) || (value.events !== undefined && !validEvents(value.events)) || (value.status !== undefined && value.status !== 'enabled' && value.status !== 'disabled')) return json({ message: 'Invalid webhook' }, 400);
    const result = await env.DB.prepare('UPDATE webhooks SET endpoint = COALESCE(?, endpoint), events = COALESCE(?, events), status = COALESCE(?, status) WHERE id = ?').bind(value.endpoint ?? null, value.events !== undefined ? JSON.stringify(value.events) : null, value.status ?? null, match[1]).run();
    return result.meta.changes ? json({ object: 'webhook', id: match[1] }) : json({ message: 'Not found' }, 404);
  }
  if (request.method === 'DELETE') {
    const result = await env.DB.prepare('DELETE FROM webhooks WHERE id = ?').bind(match[1]).run();
    return result.meta.changes ? json({ object: 'webhook', id: match[1], deleted: true }) : json({ message: 'Not found' }, 404);
  }
  return json({ message: 'Not found' }, 404);
}

interface Pending { id: string; endpoint: string; signing_secret: string; previous_secret: string | null; previous_secret_expires_at: string | null; event_id: string; event_type: string | null; type: string; recipient: string; occurred_at: string; details: string; provider_id: string; attempts: number; manual_once: number }
export async function processWebhooks(env: AuthEnv): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE webhooks SET previous_secret = NULL, previous_secret_expires_at = NULL WHERE previous_secret_expires_at <= ?').bind(now).run();
  const due = await env.DB.prepare("SELECT d.id FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id WHERE w.status = 'enabled' AND ((d.state = 'pending' AND d.next_attempt <= ?) OR (d.state = 'sending' AND d.lease_until <= ?)) ORDER BY d.next_attempt LIMIT 20").bind(now, now).all<{ id: string }>();
  for (const { id } of due.results) {
    const claimed = await env.DB.prepare("UPDATE webhook_deliveries SET state = 'sending', lease_until = ?, attempts = attempts + 1 WHERE id = ? AND EXISTS (SELECT 1 FROM webhooks WHERE id = webhook_id AND status = 'enabled') AND ((state = 'pending' AND next_attempt <= ?) OR (state = 'sending' AND lease_until <= ?)) RETURNING attempts").bind(new Date(Date.now() + 60000).toISOString(), id, now, now).first<{ attempts: number }>();
    if (!claimed) continue;
    const row = await env.DB.prepare('SELECT d.id, d.attempts, d.event_type, d.manual_once, w.endpoint, w.signing_secret, w.previous_secret, w.previous_secret_expires_at, e.id AS event_id, e.type, e.recipient, e.occurred_at, e.details, e.provider_id FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id JOIN delivery_events e ON e.id = d.event_id WHERE d.id = ?').bind(id).first<Pending>();
    if (!row) continue;
    const email = row.type === 'received' ? null : await env.DB.prepare('SELECT id, sender, subject, created_at, tags, recipients FROM email_history WHERE provider_id = ?').bind(row.provider_id).first<{ id: string; sender: string; subject: string; created_at: string; tags: string; recipients: string }>();
    const received = row.type === 'received' ? await env.DB.prepare('SELECT id, sender, recipient, subject, created_at, message_id FROM inbound_emails WHERE id = ?').bind(row.event_id.slice('received:'.length)).first<{ id: string; sender: string; recipient: string; subject: string; created_at: string; message_id: string | null }>() : null;
    const tags = email ? Object.fromEntries((JSON.parse(email.tags) as { name: string; value: string }[]).map(tag => [tag.name, tag.value])) : {};
    const candidate = JSON.stringify({ type: row.event_type ?? `email.${row.type}`, created_at: row.occurred_at, data: { email_id: received?.id ?? email?.id ?? null, created_at: received?.created_at ?? email?.created_at ?? null, ...(row.type === 'received' && { message_id: received?.message_id ?? null }), from: received?.sender ?? email?.sender ?? null, to: row.type === 'sent' && email?.recipients ? JSON.parse(email.recipients) : [row.recipient], subject: received?.subject ?? email?.subject ?? null, tags, details: JSON.parse(row.details) } });
    const snapshot = await env.DB.prepare("UPDATE webhook_deliveries SET payload = COALESCE(payload, ?) WHERE id = ? AND state = 'sending' AND attempts = ? RETURNING payload").bind(candidate, id, row.attempts).first<{ payload: string }>();
    if (!snapshot) continue;
    const payload = snapshot.payload;
    let status: number | null = null; let error: string | null = null; let response: string | null = null; let responseTruncated = false;
    const attemptedAt = new Date().toISOString();
    try {
      const headers = await webhookHeaders(row.signing_secret, `evt_${row.id}`, Math.floor(Date.now() / 1000), payload, row.previous_secret && row.previous_secret_expires_at && row.previous_secret_expires_at > new Date().toISOString() ? row.previous_secret : undefined);
      const result = await fetch(row.endpoint, { method: 'POST', headers, body: payload, redirect: 'manual', signal: AbortSignal.timeout(5000) });
      status = result.status;
      const captured = await readWebhookResponse(result.body); response = captured.text; responseTruncated = captured.truncated;
    } catch (cause) { if (status === null) error = cause instanceof Error && ['TimeoutError', 'AbortError'].includes(cause.name) ? 'timeout' : 'network_error'; }
    const record = env.DB.prepare("INSERT OR IGNORE INTO webhook_attempts (delivery_id, attempt_number, attempted_at, status, error, response, response_truncated) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM webhook_deliveries WHERE id = ? AND state = 'sending' AND attempts = ?)").bind(id, row.attempts, attemptedAt, status, error, response, responseTruncated ? 1 : 0, id, row.attempts);
    if (status !== null && status >= 200 && status < 300) {
      await env.DB.batch([record, env.DB.prepare("UPDATE webhook_deliveries SET state = 'delivered', last_status = ?, lease_until = NULL WHERE id = ? AND state = 'sending' AND attempts = ?").bind(status, id, row.attempts)]);
    } else {
      const state = row.manual_once || row.attempts >= 8 ? 'failed' : 'pending';
      const next = new Date(Date.now() + Math.min(3600000, 60000 * 2 ** (row.attempts - 1))).toISOString();
      await env.DB.batch([record, env.DB.prepare('UPDATE webhook_deliveries SET state = ?, next_attempt = ?, last_status = ?, lease_until = NULL WHERE id = ? AND state = ? AND attempts = ?').bind(state, next, status, id, 'sending', row.attempts)]);
    }
  }
}
