import { encryptCloudflareOAuthTokens } from '../src/cloudflare-oauth-connection.ts';

export async function saveCloudflareOAuthTokens(db, secret, userId, tokens) {
  const envelope = await encryptCloudflareOAuthTokens(secret, userId, tokens);
  await db.prepare('INSERT INTO cloudflare_oauth_connections (user_id, ciphertext) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET ciphertext = excluded.ciphertext, refresh_owner = NULL, refresh_until = NULL').bind(userId, envelope).run();
}
