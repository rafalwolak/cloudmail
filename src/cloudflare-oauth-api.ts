import { startCloudflareAuthorization } from './cloudflare-oauth-start.ts';
import { completeCloudflareAuthorization } from './cloudflare-oauth-token.ts';
import { consumeCloudflareOAuthState } from './cloudflare-oauth-state.ts';
import { disconnectCloudflare } from './cloudflare-oauth-disconnect.ts';

export async function handleCloudflareOAuth(request: Request, env: { DB: D1Database; BETTER_AUTH_SECRET: string; BETTER_AUTH_URL: string; CLOUDFLARE_OAUTH_CLIENT_ID?: string }, userId: string, sessionId: string): Promise<Response> {
  const url = new URL(request.url);
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
  if (url.pathname === '/api/cloudflare/oauth/status' && request.method === 'GET') {
    const connection = await env.DB.prepare('SELECT 1 AS connected FROM cloudflare_oauth_connections WHERE user_id = ?').bind(userId).first<{ connected: number }>();
    return json({ configured: Boolean(env.CLOUDFLARE_OAUTH_CLIENT_ID), connected: Boolean(connection) });
  }
  if (!env.CLOUDFLARE_OAUTH_CLIENT_ID) return json({ message: 'Cloudflare integration is not configured' }, 503);
  const redirectUri = new URL('/api/cloudflare/oauth/callback', env.BETTER_AUTH_URL).toString();
  if (url.pathname === '/api/cloudflare/oauth/disconnect' && request.method === 'POST') {
    try { await disconnectCloudflare(env.DB, env.BETTER_AUTH_SECRET, userId, env.CLOUDFLARE_OAUTH_CLIENT_ID); return json({ disconnected: true }); }
    catch { return json({ message: 'Cloudflare revocation could not be confirmed. Check authorized applications in Cloudflare.' }, 502); }
  }
  if (url.pathname === '/api/cloudflare/oauth/start' && request.method === 'POST') {
    try {
      const authorizationUrl = await startCloudflareAuthorization(env.DB, userId, sessionId, { clientId: env.CLOUDFLARE_OAUTH_CLIENT_ID, redirectUri, scopes: ['dns.write', 'zone.read', 'email-sending.read', 'email-sending.write'] });
      return json({ authorization_url: authorizationUrl });
    } catch { return json({ message: 'Cloudflare authorization could not be started' }, 503); }
  }
  if (url.pathname === '/api/cloudflare/oauth/callback' && request.method === 'GET') {
    const state = url.searchParams.getAll('state'); const code = url.searchParams.getAll('code');
    if (state.length === 1 && state[0] && code.length === 0 && url.searchParams.getAll('error').length === 1) {
      const verifier = await consumeCloudflareOAuthState(env.DB, state[0], userId, sessionId);
      if (verifier) return new Response(null, { status: 303, headers: { location: '/dashboard?cloudflare=denied', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
    }
    if (state.length !== 1 || code.length !== 1 || url.searchParams.has('error') || !state[0] || !code[0]) return json({ message: 'Cloudflare authorization was not completed' }, 400);
    try { await completeCloudflareAuthorization(env.DB, env.BETTER_AUTH_SECRET, userId, sessionId, env.CLOUDFLARE_OAUTH_CLIENT_ID, redirectUri, state[0], code[0]); }
    catch { return json({ message: 'Cloudflare authorization was not completed; start again' }, 400); }
    return new Response(null, { status: 303, headers: { location: '/dashboard?cloudflare=connected', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
  }
  return json({ message: 'Not found' }, 404);
}
