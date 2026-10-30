import { consumeCloudflareOAuthState } from './cloudflare-oauth-state.ts';
import { encryptCloudflareOAuthTokens, readCloudflareOAuthTokens, replaceCloudflareOAuthConnection, type CloudflareOAuthTokens } from './cloudflare-oauth-connection.ts';

const TOKEN_ENDPOINT = 'https://dash.cloudflare.com/oauth2/token';

async function requestTokens(params: URLSearchParams, now: number, previousRefreshToken?: string): Promise<CloudflareOAuthTokens> {
  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: params, redirect: 'manual', signal: AbortSignal.timeout(10000) });
  } catch { throw new Error('Cloudflare authorization request failed'); }
  if (!response.ok) throw new Error('Cloudflare authorization request failed');
  let result: unknown;
  try { result = await response.json(); } catch { throw new Error('Invalid Cloudflare authorization response'); }
  if (!result || typeof result !== 'object' || !('access_token' in result) || typeof result.access_token !== 'string' || !result.access_token || !('token_type' in result) || typeof result.token_type !== 'string' || result.token_type.toLowerCase() !== 'bearer' || !('expires_in' in result) || typeof result.expires_in !== 'number' || !Number.isSafeInteger(result.expires_in) || result.expires_in <= 0 || !Number.isSafeInteger(now + result.expires_in * 1000)) throw new Error('Invalid Cloudflare authorization response');
  const refreshToken = 'refresh_token' in result ? result.refresh_token : previousRefreshToken;
  if (typeof refreshToken !== 'string' || !refreshToken) throw new Error('Invalid Cloudflare authorization response');
  return { accessToken: result.access_token, refreshToken, expiresAt: now + result.expires_in * 1000 };
}

export async function completeCloudflareAuthorization(db: D1Database, secret: string, userId: string, sessionId: string, clientId: string, redirectUri: string, state: string, code: string, now = Date.now()): Promise<void> {
  if (!code || code.length > 4096) throw new Error('Invalid Cloudflare authorization callback');
  const verifier = await consumeCloudflareOAuthState(db, state, userId, sessionId, now);
  if (!verifier) throw new Error('Invalid Cloudflare authorization callback');
  const tokens = await requestTokens(new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, redirect_uri: redirectUri, code, code_verifier: verifier }), now);
  await replaceCloudflareOAuthConnection(db, secret, userId, tokens);
}

// Callers must serialize refreshes for a connection before persisting rotated refresh tokens.
export function refreshCloudflareTokens(clientId: string, refreshToken: string, now = Date.now()): Promise<CloudflareOAuthTokens> {
  return requestTokens(new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken }), now, refreshToken);
}

export async function refreshStoredCloudflareTokens(db: D1Database, secret: string, userId: string, clientId: string, now = Date.now()): Promise<CloudflareOAuthTokens> {
  const owner = crypto.randomUUID();
  const locked = await db.prepare('UPDATE cloudflare_oauth_connections SET refresh_owner = ?, refresh_until = ? WHERE user_id = ? AND (refresh_owner IS NULL OR refresh_until <= ?) RETURNING user_id')
    .bind(owner, now + 30000, userId, now).first<{ user_id: string }>();
  if (!locked) throw new Error('Cloudflare connection is unavailable or refresh is in progress');
  try {
    const current = await readCloudflareOAuthTokens(db, secret, userId);
    if (!current) throw new Error('Cloudflare connection is unavailable');
    if (current.expiresAt > now + 60000) return current;
    const refreshed = await refreshCloudflareTokens(clientId, current.refreshToken, now);
    const ciphertext = await encryptCloudflareOAuthTokens(secret, userId, refreshed);
    const result = await db.prepare('UPDATE cloudflare_oauth_connections SET ciphertext = ?, refresh_owner = NULL, refresh_until = NULL WHERE user_id = ? AND refresh_owner = ?')
      .bind(ciphertext, userId, owner).run();
    if (!result.meta.changes) throw new Error('Cloudflare connection changed during refresh');
    return refreshed;
  } finally {
    await db.prepare('UPDATE cloudflare_oauth_connections SET refresh_owner = NULL, refresh_until = NULL WHERE user_id = ? AND refresh_owner = ?').bind(userId, owner).run();
  }
}
