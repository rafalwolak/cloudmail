import type { AuthEnv } from './auth';

export function authenticationConfigured(env: Pick<AuthEnv, 'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL'>): boolean {
  if (typeof env.BETTER_AUTH_SECRET !== 'string' || env.BETTER_AUTH_SECRET.length < 32 || env.BETTER_AUTH_SECRET === 'replace-with-a-unique-random-secret') return false;
  try {
    const url = new URL(env.BETTER_AUTH_URL);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return url.origin !== 'https://example.com' && (url.protocol === 'https:' || (local && url.protocol === 'http:')) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
  } catch { return false; }
}

export function configuredMailbox(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@<>]+@[^\s@<>.]+(?:\.[^\s@<>.]+)+$/.test(value);
}
