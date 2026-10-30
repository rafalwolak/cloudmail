import { createAuth, type AuthEnv } from './auth';
import { parseEmail } from './email';
import { isValidKey, manageKeys, type KeyEnv } from './keys';

interface Env extends AuthEnv, KeyEnv { API_KEY: string; ASSETS: Fetcher }

const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cloudmail - transactional email on Cloudflare</title><style>body{margin:0;background:#101613;color:#f2f4ec;font:16px system-ui}main{max-width:1000px;margin:auto;padding:36px 24px}nav{display:flex;justify-content:space-between;align-items:center}a{color:#c0efa0}header{padding:110px 0 80px}h1{font-size:clamp(48px,8vw,100px);line-height:.98;letter-spacing:-.06em;max-width:800px;margin:22px 0}p{line-height:1.7;color:#b9c5b8;max-width:620px}.tag{color:#b9ec94;font-size:13px;letter-spacing:.12em;text-transform:uppercase}section{border-top:1px solid #39443c;padding:35px 0}code{color:#b9ec94}footer{padding:60px 0;color:#9aab9c}</style></head><body><main><nav><strong>✳ CLOUDMAIL</strong><a href="/dashboard">Dashboard ↗</a></nav><header><span class="tag">Open source · Cloudflare native</span><h1>Email, on your own terms.</h1><p>A self-hosted foundation for transactional email. Built for developers who want a simple API and infrastructure they control.</p></header><section><span class="tag">Early development</span><h2>Built in the open.</h2><p>Cloudmail is under active development. Email sending requires a verified Cloudflare sending domain and an API key. Sign in to manage your API keys in the dashboard.</p><p>API endpoint: <code>POST /emails</code></p></section><footer>Cloudmail · Transactional email only</footer></main></body></html>`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/auth/')) {
      if (!env.BETTER_AUTH_SECRET || !env.BETTER_AUTH_URL) return Response.json({ message: 'Authentication is not configured' }, { status: 503 });
      return createAuth(env).handler(request);
    }
    if (url.pathname === '/api/keys' || url.pathname.startsWith('/api/keys/')) return manageKeys(request, env);
    if (request.method === 'GET' && ['/dashboard', '/dashboard.js', '/dashboard.css'].includes(url.pathname)) {
      const path = url.pathname === '/dashboard' ? '/dashboard.html' : url.pathname;
      const response = await env.ASSETS.fetch(new Request(new URL(path, url), request));
      const headers = new Headers(response.headers);
      headers.set('content-security-policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      headers.set('x-content-type-options', 'nosniff');
      headers.set('referrer-policy', 'no-referrer');
      headers.set('cache-control', 'no-store');
      return new Response(response.body, { status: response.status, headers });
    }
    if (url.pathname === '/' && request.method === 'GET') return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'", 'x-content-type-options': 'nosniff' } });
    if (url.pathname !== '/emails' || request.method !== 'POST') return Response.json({ message: 'Not found' }, { status: 404 });
    const authorization = request.headers.get('Authorization') || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!(env.API_KEY && token === env.API_KEY) && !await isValidKey(env.DB, token, env.ADMIN_EMAIL)) return Response.json({ message: 'Unauthorized' }, { status: 401 });
    let data: unknown;
    try { data = await request.json(); } catch { return Response.json({ message: 'Invalid JSON' }, { status: 400 }); }
    const email = parseEmail(data);
    if (typeof email === 'string') return Response.json({ message: email }, { status: 400 });
    try {
      const result = await env.EMAIL.send(email);
      return Response.json({ id: result.messageId });
    } catch { return Response.json({ message: 'Email could not be sent. Check the sending domain and Cloudflare configuration.' }, { status: 502 }); }
  }
};
