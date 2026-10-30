export interface CloudflareOAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const encode = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (value: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

async function encryptionKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error('Authentication secret is not configured');
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('cloudmail-cloudflare-oauth-v1'), info: encoder.encode('token-encryption') }, key, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptCloudflareOAuthTokens(secret: string, userId: string, tokens: CloudflareOAuthTokens): Promise<string> {
  if (!tokens.accessToken || tokens.accessToken.length > 8192 || !tokens.refreshToken || tokens.refreshToken.length > 8192 || !Number.isSafeInteger(tokens.expiresAt) || tokens.expiresAt <= 0) throw new Error('Invalid Cloudflare OAuth tokens');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(userId) }, await encryptionKey(secret), encoder.encode(JSON.stringify(tokens)));
  return `v1.${encode(iv)}.${encode(new Uint8Array(ciphertext))}`;
}

export async function saveCloudflareOAuthTokens(db: D1Database, secret: string, userId: string, tokens: CloudflareOAuthTokens): Promise<void> {
  const envelope = await encryptCloudflareOAuthTokens(secret, userId, tokens);
  await db.prepare('INSERT INTO cloudflare_oauth_connections (user_id, ciphertext) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET ciphertext = excluded.ciphertext, refresh_owner = NULL, refresh_until = NULL').bind(userId, envelope).run();
}

export async function replaceCloudflareOAuthConnection(db: D1Database, secret: string, userId: string, tokens: CloudflareOAuthTokens): Promise<void> {
  const envelope = await encryptCloudflareOAuthTokens(secret, userId, tokens);
  await db.batch([
    db.prepare('INSERT INTO cloudflare_oauth_connections (user_id, ciphertext) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET ciphertext = excluded.ciphertext, refresh_owner = NULL, refresh_until = NULL').bind(userId, envelope),
    db.prepare('DELETE FROM cloudflare_zones WHERE user_id = ?').bind(userId),
  ]);
}

export async function readCloudflareOAuthTokens(db: D1Database, secret: string, userId: string): Promise<CloudflareOAuthTokens | null> {
  const row = await db.prepare('SELECT ciphertext FROM cloudflare_oauth_connections WHERE user_id = ?').bind(userId).first<{ ciphertext: string }>();
  if (!row) return null;
  const [version, iv, ciphertext, extra] = row.ciphertext.split('.');
  if (version !== 'v1' || !iv || !ciphertext || extra !== undefined) throw new Error('Invalid Cloudflare OAuth connection');
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv), additionalData: encoder.encode(userId) }, await encryptionKey(secret), decode(ciphertext));
  const tokens: unknown = JSON.parse(decoder.decode(plaintext));
  if (!tokens || typeof tokens !== 'object' || !('accessToken' in tokens) || typeof tokens.accessToken !== 'string' || !tokens.accessToken || tokens.accessToken.length > 8192 || !('refreshToken' in tokens) || typeof tokens.refreshToken !== 'string' || !tokens.refreshToken || tokens.refreshToken.length > 8192 || !('expiresAt' in tokens) || (!Number.isSafeInteger(tokens.expiresAt) || typeof tokens.expiresAt !== 'number' || tokens.expiresAt <= 0)) throw new Error('Invalid Cloudflare OAuth connection');
  return tokens as CloudflareOAuthTokens;
}
