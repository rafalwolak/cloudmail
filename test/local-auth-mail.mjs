import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export function localTestOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Authentication fixtures require a local HTTP origin');
  return url.origin;
}

export function localAuthLink(content, base, pathname, email) {
  const origin = localTestOrigin(base);
  for (const match of content.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    try {
      const url = new URL(match[0]);
      if (url.origin !== origin || url.username || url.password || !url.pathname.startsWith(pathname)) continue;
      if (email) {
        const payload = JSON.parse(Buffer.from(url.searchParams.get('token').split('.')[1], 'base64url').toString());
        // Better Auth verifies the signature when the link is opened. Match only the intended fixture here.
        if (payload.email !== email) continue;
      }
      return url;
    } catch { /* Ignore unrelated or malformed links in simulated messages. */ }
  }
  return null;
}

export async function captureLocalAuthLink(action, { base, pathname, email, directory = '.wrangler/tmp/email' }) {
  localTestOrigin(base);
  const files = async () => {
    try { return (await readdir(directory, { recursive: true })).filter(path => path.split(/[\\/]/).includes('email-text') && path.endsWith('.txt')); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  };
  const before = new Set(await files());
  const response = await action();
  if (!response.ok) throw new Error(`Local authentication fixture request failed (${response.status})`);
  const deadline = Date.now() + 10000;
  do {
    for (const file of await files()) {
      if (before.has(file)) continue;
      const url = localAuthLink(await readFile(join(directory, file), 'utf8'), base, pathname, email);
      if (url) return url;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw new Error('Expected authentication link was not captured in a new local email');
}
