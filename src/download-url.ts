import type { AuthEnv } from './auth';
import { authenticationConfigured } from './auth-config.ts';

export type DownloadSigningEnv = Pick<AuthEnv, 'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL'> & { ADMIN_EMAIL?: string };
export const privateDownloadHeaders = { 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'", 'access-control-allow-origin': '*' };
const encoder = new TextEncoder();
const key = (env: DownloadSigningEnv) => crypto.subtle.importKey('raw', encoder.encode(env.BETTER_AUTH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
// Purpose and resource fields separate download signatures from other uses of the installation secret.
const payload = (purpose: string, resource: (string | number)[], expires: number, env: DownloadSigningEnv) => encoder.encode(JSON.stringify([purpose, new URL(env.BETTER_AUTH_URL).origin, env.ADMIN_EMAIL?.trim().toLowerCase() ?? '', ...resource, expires]));

export async function createDownloadUrl(path: string, purpose: string, resource: (string | number)[], env: DownloadSigningEnv, lifetime: number, now = Date.now()): Promise<{ download_url: string; expires_at: string } | null> {
  if (!authenticationConfigured(env)) return null;
  const expires = Math.floor(now / 1000) + lifetime;
  const mac = await crypto.subtle.sign('HMAC', await key(env), payload(purpose, resource, expires, env));
  const url = new URL(path, env.BETTER_AUTH_URL);
  url.searchParams.set('expires', String(expires));
  url.searchParams.set('signature', Array.from(new Uint8Array(mac), byte => byte.toString(16).padStart(2, '0')).join(''));
  return { download_url: url.href, expires_at: new Date(expires * 1000).toISOString() };
}

export async function verifyDownloadUrl(request: Request, purpose: string, resource: (string | number)[], env: DownloadSigningEnv, lifetime: number, now = Date.now()): Promise<boolean> {
  const url = new URL(request.url); const params = url.searchParams;
  const expires = params.get('expires') ?? ''; const signature = params.get('signature') ?? '';
  if (!authenticationConfigured(env) || url.origin !== new URL(env.BETTER_AUTH_URL).origin || [...params.keys()].some(name => !['expires', 'signature'].includes(name)) || params.getAll('expires').length !== 1 || params.getAll('signature').length !== 1 || !/^[1-9]\d{0,12}$/.test(expires) || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const remaining = Number(expires) - Math.floor(now / 1000);
  if (remaining <= 0 || remaining > lifetime) return false;
  const mac = Uint8Array.from({ length: 32 }, (_, index) => Number.parseInt(signature.slice(index * 2, index * 2 + 2), 16));
  return crypto.subtle.verify('HMAC', await key(env), mac, payload(purpose, resource, Number(expires), env));
}
