import { manageSelectedZoneDomains } from './cloudflare-domain-management.ts';
import { checkPublicDns } from './dns-check.ts';

export async function checkSelectedDomainDns(request: Request, env: { DB: D1Database; BETTER_AUTH_SECRET: string; CLOUDFLARE_OAUTH_CLIENT_ID?: string }, userId: string): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== 'GET' || !/^\/api\/cloudflare\/zones\/[a-f0-9]{32}\/domains\/[a-f0-9]{32}\/dns\/check$/i.test(url.pathname) || url.search) return Response.json({ message: 'Not found' }, { status: 404 });
  url.pathname = url.pathname.slice(0, -'/check'.length);
  const response = await manageSelectedZoneDomains(new Request(url, request), env, userId);
  if (!response.ok) return response;
  const body = await response.json() as { data?: unknown; result_info?: unknown; incomplete?: boolean };
  if (!Array.isArray(body.data) || body.data.length > 20 || body.data.some(record => !record || typeof record.type !== 'string' || typeof record.name !== 'string' || typeof record.content !== 'string')) return Response.json({ message: 'Unexpected Cloudflare DNS response' }, { status: 502 });
  return Response.json({ object: 'domain_dns_check', data: await checkPublicDns(body.data), incomplete: body.incomplete === true, result_info: body.result_info }, { headers: { 'cache-control': 'no-store' } });
}
