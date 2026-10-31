import type { AuthEnv } from './auth';
import { authenticationConfigured } from './auth-config.ts';

export interface ReceivedRawEnv extends Pick<AuthEnv, 'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL'> { DB: D1Database; INBOUND: R2Bucket; ADMIN_EMAIL?: string }
const lifetime = 5 * 60;
const identifier = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const headers = { 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'", 'access-control-allow-origin': '*' };
const encoder = new TextEncoder();
const json = (message: string, status: number) => Response.json({ message }, { status, headers });
const download = (body: ReadableStream | null, size: number, id: string) => new Response(body, { headers: { ...headers, 'content-type': 'application/octet-stream', 'content-length': String(size), 'content-disposition': `attachment; filename="${id}.eml"` } });
const key = (env: ReceivedRawEnv) => crypto.subtle.importKey('raw', encoder.encode(env.BETTER_AUTH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
// Domain separation prevents these signatures from authenticating another use of the installation secret.
const payload = (id: string, expires: number, env: ReceivedRawEnv) => encoder.encode(JSON.stringify(['cloudmail:received-raw:v1', new URL(env.BETTER_AUTH_URL).origin, env.ADMIN_EMAIL?.trim().toLowerCase() ?? '', id, expires]));

export async function createReceivedRawDownload(id: string, env: ReceivedRawEnv, now = Date.now()): Promise<{ download_url: string; expires_at: string } | null> {
  if (!identifier.test(id) || !authenticationConfigured(env)) return null;
  const expires = Math.floor(now / 1000) + lifetime;
  const mac = await crypto.subtle.sign('HMAC', await key(env), payload(id, expires, env));
  const url = new URL(`/downloads/receiving/${id}/raw`, env.BETTER_AUTH_URL);
  url.searchParams.set('expires', String(expires));
  url.searchParams.set('signature', Array.from(new Uint8Array(mac), byte => byte.toString(16).padStart(2, '0')).join(''));
  return { download_url: url.href, expires_at: new Date(expires * 1000).toISOString() };
}

export async function downloadReceivedRaw(request: Request, env: ReceivedRawEnv, now = Date.now()): Promise<Response> {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/downloads\/receiving\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/raw$/);
  if (!match) return json('Not found', 404);
  if (!['GET', 'HEAD'].includes(request.method)) return Response.json({ message: 'Method not allowed' }, { status: 405, headers: { ...headers, allow: 'GET, HEAD' } });
  const params = url.searchParams; const expires = params.get('expires') ?? ''; const signature = params.get('signature') ?? '';
  if (!authenticationConfigured(env) || url.origin !== new URL(env.BETTER_AUTH_URL).origin || [...params.keys()].some(name => !['expires', 'signature'].includes(name)) || params.getAll('expires').length !== 1 || params.getAll('signature').length !== 1 || !/^[1-9]\d{0,12}$/.test(expires) || !/^[0-9a-f]{64}$/.test(signature)) return json('Invalid or expired download link', 403);
  const remaining = Number(expires) - Math.floor(now / 1000);
  if (remaining <= 0 || remaining > lifetime) return json('Invalid or expired download link', 403);
  const mac = Uint8Array.from({ length: 32 }, (_, index) => Number.parseInt(signature.slice(index * 2, index * 2 + 2), 16));
  if (!await crypto.subtle.verify('HMAC', await key(env), mac, payload(match[1], Number(expires), env))) return json('Invalid or expired download link', 403);
  try {
    const row = await env.DB.prepare('SELECT object_key FROM inbound_emails WHERE id = ?').bind(match[1]).first<{ object_key: string }>();
    if (!row) return json('Not found', 404);
    if (request.method === 'HEAD') {
      const object = await env.INBOUND.head(row.object_key);
      return object ? download(null, object.size, match[1]) : json('Email content is unavailable', 503);
    }
    const object = await env.INBOUND.get(row.object_key);
    return object ? download(object.body, object.size, match[1]) : json('Email content is unavailable', 503);
  } catch { return json('Email content is unavailable', 503); }
}
