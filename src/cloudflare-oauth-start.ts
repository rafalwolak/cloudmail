import { createCloudflareOAuthState } from './cloudflare-oauth-state.ts';

export interface CloudflareOAuthClient {
  clientId: string;
  redirectUri: string;
  scopes: string[];
}

export async function startCloudflareAuthorization(db: D1Database, userId: string, sessionId: string, client: CloudflareOAuthClient, now = Date.now()): Promise<string> {
  let redirect: URL;
  try { redirect = new URL(client.redirectUri); } catch { throw new Error('Cloudflare OAuth client is not configured'); }
  if (!client.clientId || redirect.protocol !== 'https:' || redirect.username || redirect.password || redirect.hash || !client.scopes.length || client.scopes.some(scope => !/^[a-z0-9_-]+(?:\.[a-z0-9_-]+)+$/.test(scope))) throw new Error('Cloudflare OAuth client is not configured');
  const { state, challenge } = await createCloudflareOAuthState(db, userId, sessionId, now);
  const url = new URL('https://dash.cloudflare.com/oauth2/auth');
  url.search = new URLSearchParams({ response_type: 'code', client_id: client.clientId, redirect_uri: client.redirectUri, scope: [...new Set([...client.scopes, 'offline_access'])].join(' '), state, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
  return url.toString();
}
