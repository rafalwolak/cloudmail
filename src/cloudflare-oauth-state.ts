const encoder = new TextEncoder();
const base64url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const digest = async (value: string): Promise<string> => base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
const random = (): string => base64url(crypto.getRandomValues(new Uint8Array(32)));

export async function createCloudflareOAuthState(db: D1Database, userId: string, now = Date.now()): Promise<{ state: string; challenge: string }> {
  const state = random();
  const verifier = random();
  await db.prepare('DELETE FROM cloudflare_oauth_states WHERE expires_at <= ?').bind(now).run();
  await db.prepare('INSERT INTO cloudflare_oauth_states (state_hash, user_id, verifier, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await digest(state), userId, verifier, now + 10 * 60 * 1000).run();
  return { state, challenge: await digest(verifier) };
}

export async function consumeCloudflareOAuthState(db: D1Database, state: string, userId: string, now = Date.now()): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(state)) return null;
  const row = await db.prepare('DELETE FROM cloudflare_oauth_states WHERE state_hash = ? AND user_id = ? AND expires_at > ? RETURNING verifier')
    .bind(await digest(state), userId, now).first<{ verifier: string }>();
  return row?.verifier ?? null;
}
