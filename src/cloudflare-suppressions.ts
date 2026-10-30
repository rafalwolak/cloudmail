import { z } from 'zod';
import { refreshStoredCloudflareTokens } from './cloudflare-oauth-token.ts';

export async function manageCloudflareSuppressions(request: Request, env: { DB: D1Database; BETTER_AUTH_SECRET: string; CLOUDFLARE_OAUTH_CLIENT_ID?: string }, userId: string): Promise<Response> {
  const url = new URL(request.url); const match = url.pathname.match(/^\/api\/cloudflare\/zones\/([a-f0-9]{32})\/suppressions(?:\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}))?$/i);
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
  if (!match || (match[2] ? request.method !== 'DELETE' : !['GET', 'POST'].includes(request.method))) return json({ message: 'Not found' }, 404);
  if (request.method !== 'GET' && url.search) return json({ message: 'Unsupported query parameter' }, 400);
  if (request.method === 'GET' && ([...url.searchParams.keys()].some(key => key !== 'cursor') || url.searchParams.getAll('cursor').length > 1 || (url.searchParams.has('cursor') && (!url.searchParams.get('cursor') || url.searchParams.get('cursor')!.length > 2048)))) return json({ message: 'Invalid cursor' }, 400);
  let payload: unknown;
  if (request.method === 'POST') {
    let body: unknown; try { body = await request.json(); } catch { return json({ message: 'Invalid JSON' }, 400); }
    const schema = z.object({ email: z.email().max(320), expires_at: z.iso.datetime({ offset: true }).nullable().optional(), note: z.string().max(1000).optional(), scope: z.union([z.object({ type: z.literal('account') }).strict(), z.object({ type: z.literal('sending_domain'), value: z.string().min(1).max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/i) }).strict()]) }).strict();
    const result = schema.safeParse(body);
    if (!result.success || (result.data.expires_at && Date.parse(result.data.expires_at) <= Date.now())) return json({ message: 'Invalid suppression details' }, 400);
    payload = result.data;
  }
  if (!env.CLOUDFLARE_OAUTH_CLIENT_ID) return json({ message: 'Cloudflare integration is not configured' }, 503);
  const zone = await env.DB.prepare('SELECT account_id FROM cloudflare_zones WHERE user_id = ? AND zone_id = ?').bind(userId, match[1].toLowerCase()).first<{ account_id: string }>();
  if (!zone || !/^[a-f0-9]{32}$/i.test(zone.account_id)) return json({ message: 'Cloudflare zone not found' }, 404);
  try {
    const { accessToken } = await refreshStoredCloudflareTokens(env.DB, env.BETTER_AUTH_SECRET, userId, env.CLOUDFLARE_OAUTH_CLIENT_ID);
    const target = new URL(`https://api.cloudflare.com/client/v4/accounts/${zone.account_id}/email/sending/suppressions`);
    if (request.method === 'DELETE') {
      target.pathname += `/${match[2]}`;
      const inspection = await fetch(target, { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(10000) });
      const details = await inspection.json() as { success?: boolean; result?: { id?: string; read_only?: boolean } };
      if (!inspection.ok || details.success !== true || details.result?.id?.toLowerCase() !== match[2]!.toLowerCase()) throw new Error('Invalid response');
      if (details.result.read_only !== false) return json({ message: 'Suppression is read-only or its mutability is unknown' }, 409);
    }
    if (request.method === 'GET') target.searchParams.set('per_page', '100');
    if (url.searchParams.has('cursor')) target.searchParams.set('cursor', url.searchParams.get('cursor')!);
    const response = await fetch(target, { method: request.method, headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json', ...(payload ? { 'content-type': 'application/json' } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}), redirect: 'manual', signal: AbortSignal.timeout(10000) });
    const result = await response.json() as { success?: boolean; result?: unknown; result_info?: { next_cursor?: unknown } };
    if (!response.ok || result.success !== true) throw new Error('Invalid response');
    if (request.method === 'DELETE') {
      if (!result.result || typeof result.result !== 'object' || !('id' in result.result) || (typeof result.result.id !== 'string' || result.result.id.toLowerCase() !== match[2]!.toLowerCase())) throw new Error('Invalid response');
      return json({ id: match[2], deleted: true });
    }
    if (request.method === 'POST') {
      if (!result.result || typeof result.result !== 'object' || !('id' in result.result) || typeof result.result.id !== 'string') throw new Error('Invalid response');
      return json({ object: 'suppression', data: result.result }, 201);
    }
    if (!Array.isArray(result.result)) throw new Error('Invalid response');
    const cursor = result.result_info?.next_cursor;
    if (cursor !== undefined && cursor !== null && typeof cursor !== 'string') throw new Error('Invalid cursor');
    return json({ object: 'list', data: result.result, next_cursor: cursor ?? null });
  } catch { return json({ message: 'Cloudflare suppression request could not be confirmed' }, 502); }
}
