import type { AuthEnv } from './auth';
import { createDownloadUrl, verifyDownloadUrl, privateDownloadHeaders } from './download-url.ts';

export interface ReceivedRawEnv extends Pick<AuthEnv, 'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL'> { DB: D1Database; INBOUND: R2Bucket; ADMIN_EMAIL?: string }
const lifetime = 5 * 60;
const identifier = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const headers = privateDownloadHeaders;
const json = (message: string, status: number) => Response.json({ message }, { status, headers });
const download = (body: ReadableStream | null, size: number, id: string) => new Response(body, { headers: { ...headers, 'content-type': 'application/octet-stream', 'content-length': String(size), 'content-disposition': `attachment; filename="${id}.eml"` } });
export async function createReceivedRawDownload(id: string, env: ReceivedRawEnv, now = Date.now()): Promise<{ download_url: string; expires_at: string } | null> {
  if (!identifier.test(id)) return null;
  return createDownloadUrl(`/downloads/receiving/${id}/raw`, 'cloudmail:received-raw:v1', [id], env, lifetime, now);
}

export async function downloadReceivedRaw(request: Request, env: ReceivedRawEnv, now = Date.now()): Promise<Response> {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/downloads\/receiving\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/raw$/);
  if (!match) return json('Not found', 404);
  if (!['GET', 'HEAD'].includes(request.method)) return Response.json({ message: 'Method not allowed' }, { status: 405, headers: { ...headers, allow: 'GET, HEAD' } });
  if (!await verifyDownloadUrl(request, 'cloudmail:received-raw:v1', [match[1]], env, lifetime, now)) return json('Invalid or expired download link', 403);
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
