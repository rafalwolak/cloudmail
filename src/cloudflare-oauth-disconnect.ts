import { readCloudflareOAuthTokens } from './cloudflare-oauth-connection.ts';

export async function disconnectCloudflare(db: D1Database, secret: string, userId: string, clientId: string, now = Date.now()): Promise<void> {
  const owner = crypto.randomUUID();
  const locked = await db.prepare('UPDATE cloudflare_oauth_connections SET refresh_owner = ?, refresh_until = ? WHERE user_id = ? AND (refresh_owner IS NULL OR refresh_until <= ?) RETURNING user_id').bind(owner, now + 30000, userId, now).first<{ user_id: string }>();
  if (!locked) throw new Error('Cloudflare connection is unavailable or busy');
  try {
    const tokens = await readCloudflareOAuthTokens(db, secret, userId);
    if (!tokens) throw new Error('Cloudflare connection is unavailable');
    for (const [token, hint] of [[tokens.accessToken, 'access_token'], [tokens.refreshToken, 'refresh_token']]) {
      const response = await fetch('https://dash.cloudflare.com/oauth2/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, token, token_type_hint: hint }), redirect: 'manual', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Cloudflare revocation could not be confirmed');
    }
    const result = await db.prepare('DELETE FROM cloudflare_oauth_connections WHERE user_id = ? AND refresh_owner = ?').bind(userId, owner).run();
    if (!result.meta.changes) throw new Error('Cloudflare connection changed during revocation');
  } finally {
    await db.prepare('UPDATE cloudflare_oauth_connections SET refresh_owner = NULL, refresh_until = NULL WHERE user_id = ? AND refresh_owner = ?').bind(userId, owner).run();
  }
}
