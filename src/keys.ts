import { createAuth, type AuthEnv } from './auth';

export interface KeyEnv extends AuthEnv { ADMIN_EMAIL?: string }

async function hashKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function isValidKey(db: D1Database, key: string, adminEmail?: string): Promise<boolean> {
  if (!adminEmail || !/^clm_[a-f0-9]{64}$/.test(key)) return false;
  const result = await db.prepare('SELECT api_keys.id FROM api_keys JOIN "user" ON "user".id = api_keys.user_id WHERE api_keys.key_hash = ? AND lower("user".email) = lower(?) AND "user"."emailVerified" = 1').bind(await hashKey(key), adminEmail).first();
  return result !== null;
}

export async function authorizeAdmin(request: Request, env: KeyEnv): Promise<{ id: string } | Response> {
  if (!env.BETTER_AUTH_SECRET || !env.BETTER_AUTH_URL) return Response.json({ message: 'Authentication is not configured' }, { status: 503 });
  const session = await createAuth(env).api.getSession({ headers: request.headers });
  if (!session) return Response.json({ message: 'Unauthorized' }, { status: 401 });
  if (!env.ADMIN_EMAIL || !session.user.emailVerified || session.user.email.toLowerCase() !== env.ADMIN_EMAIL.toLowerCase()) return Response.json({ message: 'Forbidden' }, { status: 403 });
  return { id: session.user.id };
}

export async function manageKeys(request: Request, env: KeyEnv): Promise<Response> {
  const admin = await authorizeAdmin(request, env);
  if (admin instanceof Response) return admin;
  if (request.method !== 'GET' && request.headers.get('origin') !== new URL(env.BETTER_AUTH_URL).origin) return Response.json({ message: 'Invalid origin' }, { status: 403 });
  const path = new URL(request.url).pathname;
  if (request.method === 'GET' && path === '/api/keys') {
    const result = await env.DB.prepare('SELECT id, name, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC').bind(admin.id).all();
    return Response.json({ data: result.results }, { headers: { 'cache-control': 'no-store' } });
  }
  if (request.method === 'POST' && path === '/api/keys') {
    let body: unknown;
    try { body = await request.json(); } catch { return Response.json({ message: 'Invalid JSON' }, { status: 400 }); }
    const name = body && typeof body === 'object' && 'name' in body ? body.name : null;
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 100) return Response.json({ message: 'A name of 1-100 characters is required' }, { status: 400 });
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const key = 'clm_' + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO api_keys (id, user_id, name, key_hash, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, admin.id, name.trim(), await hashKey(key), new Date().toISOString()).run();
    return Response.json({ id, token: key }, { status: 201, headers: { 'cache-control': 'no-store' } });
  }
  if (request.method === 'DELETE' && path.startsWith('/api/keys/')) {
    const id = path.slice('/api/keys/'.length);
    const result = await env.DB.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?').bind(id, admin.id).run();
    return result.meta.changes ? new Response(null, { status: 204 }) : Response.json({ message: 'Not found' }, { status: 404 });
  }
  return Response.json({ message: 'Not found' }, { status: 404 });
}
