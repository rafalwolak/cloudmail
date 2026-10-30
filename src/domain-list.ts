import { listSelectedCloudflareZones } from './cloudflare-zone-selection.ts';
import { refreshStoredCloudflareTokens } from './cloudflare-oauth-token.ts';
import { manageDomains } from './domains.ts';
import { manageSelectedZoneDomains } from './cloudflare-domain-management.ts';

export async function listDomains(request: Request, env: { DB: D1Database; BETTER_AUTH_SECRET: string; CLOUDFLARE_OAUTH_CLIENT_ID?: string }, userId: string): Promise<Response> {
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => !['limit', 'before', 'after'].includes(key)) || ['limit', 'before', 'after'].some(key => params.getAll(key).length > 1)) return json({ message: 'Invalid pagination' }, 400);
  const rawLimit = params.get('limit'); const before = params.get('before'); const after = params.get('after');
  if ((rawLimit !== null && (!/^[0-9]+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100)) || (before !== null && after !== null) || before === '' || after === '') return json({ message: 'Invalid pagination' }, 400);
  if (!env.CLOUDFLARE_OAUTH_CLIENT_ID) return json({ message: 'Cloudflare domain management is not configured' }, 503);
  const zones = await listSelectedCloudflareZones(env.DB, userId);
  if (zones.length === 0) return before !== null || after !== null ? json({ message: 'Invalid cursor' }, 400) : json({ object: 'list', data: [], has_more: false });
  if (zones.length > 50) return json({ message: 'Too many zones to list safely' }, 503);
  try {
    const { accessToken } = await refreshStoredCloudflareTokens(env.DB, env.BETTER_AUTH_SECRET, userId, env.CLOUDFLARE_OAUTH_CLIENT_ID);
    const domains: { id: string; name: string; status: string; zone_id: string; enabled: boolean; created_at?: string }[] = []; const tags = new Set<string>();
    for (const zone of zones) {
      const response = await manageDomains(new Request('https://cloudmail.invalid/domains'), { zoneId: zone.id, accessToken });
      if (!response.ok) return json({ message: 'Cloudflare domains could not be retrieved' }, 502);
      const page = await response.json() as { data: { tag: string; name: string; enabled: boolean; created?: string }[]; result_info?: { total_pages?: number } };
      if (Number(page.result_info?.total_pages) > 1) return json({ message: 'Cloudflare returned an incomplete domain list; pagination is not supported by its documented API' }, 502);
      for (const domain of page.data) {
        if (tags.has(domain.tag.toLowerCase())) return json({ message: 'Cloudflare domain identifiers are ambiguous' }, 502);
        tags.add(domain.tag.toLowerCase());
        domains.push({ id: domain.tag, name: domain.name, status: 'unknown', zone_id: zone.id, enabled: domain.enabled, ...(domain.created && { created_at: domain.created }) });
      }
    }
    domains.sort((a, b) => a.id.localeCompare(b.id));
    const cursor = before ?? after;
    const anchor = cursor === null ? -1 : domains.findIndex(domain => domain.id.toLowerCase() === cursor.toLowerCase());
    if (cursor !== null && anchor === -1) return json({ message: 'Invalid cursor' }, 400);
    const limit = rawLimit === null ? domains.length : Number(rawLimit);
    const start = after !== null ? anchor + 1 : before !== null ? Math.max(0, anchor - limit) : 0;
    const end = before !== null ? anchor : Math.min(domains.length, start + limit);
    return json({ object: 'list', data: domains.slice(start, end), has_more: before !== null ? start > 0 : end < domains.length });
  } catch { return json({ message: 'Cloudflare domains could not be retrieved' }, 502); }
}

export async function createDomain(request: Request, env: { DB: D1Database; BETTER_AUTH_SECRET: string; CLOUDFLARE_OAUTH_CLIENT_ID?: string }, userId: string): Promise<Response> {
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
  if (new URL(request.url).search) return json({ message: 'Unsupported query parameter' }, 400);
  let body: unknown; try { body = await request.json(); } catch { return json({ message: 'Invalid JSON' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'name') || !('name' in body) || typeof body.name !== 'string' || !/^(?=.{1,253}$)(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(body.name)) return json({ message: 'A valid domain name is required; unsupported fields are not accepted' }, 400);
  if (!env.CLOUDFLARE_OAUTH_CLIENT_ID) return json({ message: 'Cloudflare domain management is not configured' }, 503);
  const name = body.name.toLowerCase(); const base = name.startsWith('*.') ? name.slice(2) : name;
  const zones = await listSelectedCloudflareZones(env.DB, userId);
  const matching = zones.filter(zone => base === zone.name.toLowerCase() || base.endsWith(`.${zone.name.toLowerCase()}`)).sort((a, b) => b.name.length - a.name.length);
  if (!matching.length) return json({ message: 'Select a matching Cloudflare zone first' }, 404);
  try {
    const { accessToken } = await refreshStoredCloudflareTokens(env.DB, env.BETTER_AUTH_SECRET, userId, env.CLOUDFLARE_OAUTH_CLIENT_ID);
    const response = await manageDomains(new Request('https://cloudmail.invalid/domains', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }), { zoneId: matching[0].id, accessToken });
    if (!response.ok) return json({ message: 'Cloudflare domain request could not be confirmed; check before retrying' }, 502);
    const payload = await response.json() as { data?: { tag?: unknown; name?: unknown; enabled?: unknown; created?: unknown } };
    const domain = payload.data;
    if (!domain || typeof domain.tag !== 'string' || !/^[a-f0-9]{32}$/i.test(domain.tag) || domain.name !== name || typeof domain.enabled !== 'boolean') return json({ message: 'Cloudflare domain request could not be confirmed; check before retrying' }, 502);
    return json({ id: domain.tag, name: domain.name, status: 'unknown', zone_id: matching[0].id, enabled: domain.enabled, ...(typeof domain.created === 'string' && { created_at: domain.created }) });
  } catch { return json({ message: 'Cloudflare domain request could not be confirmed; check before retrying' }, 502); }
}

export async function getDomain(request: Request, env: { DB: D1Database; BETTER_AUTH_SECRET: string; CLOUDFLARE_OAUTH_CLIENT_ID?: string }, userId: string): Promise<Response> {
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
  const url = new URL(request.url); const match = url.pathname.match(/^\/domains\/([a-f0-9]{32})$/i);
  if (!match) return json({ message: 'Not found' }, 404);
  const id = match[1].toLowerCase();
  if (url.search) return json({ message: 'Unsupported query parameter' }, 400);
  if (!env.CLOUDFLARE_OAUTH_CLIENT_ID) return json({ message: 'Cloudflare domain management is not configured' }, 503);
  const zones = await listSelectedCloudflareZones(env.DB, userId);
  if (zones.length > 50) return json({ message: 'Too many zones to search safely' }, 503);
  if (!zones.length) return json({ message: 'Domain not found' }, 404);
  try {
    const { accessToken } = await refreshStoredCloudflareTokens(env.DB, env.BETTER_AUTH_SECRET, userId, env.CLOUDFLARE_OAUTH_CLIENT_ID);
    let found: { zoneId: string; domain: { tag: string; name: string; enabled: boolean; created?: string } } | undefined;
    for (const zone of zones) {
      const response = await manageDomains(new Request(`https://cloudmail.invalid/domains/${id}`), { zoneId: zone.id, accessToken });
      if (response.status === 404) continue;
      if (!response.ok) return json({ message: 'Cloudflare domain could not be retrieved' }, 502);
      const data = (await response.json() as { data?: unknown }).data;
      if (!data || typeof data !== 'object' || !('tag' in data) || typeof data.tag !== 'string' || data.tag.toLowerCase() !== id || !('name' in data) || typeof data.name !== 'string' || !('enabled' in data) || typeof data.enabled !== 'boolean') return json({ message: 'Invalid Cloudflare domain response' }, 502);
      if (found) return json({ message: 'Cloudflare domain identifier is ambiguous' }, 502);
      found = { zoneId: zone.id, domain: data as { tag: string; name: string; enabled: boolean; created?: string } };
    }
    if (!found) return json({ message: 'Domain not found' }, 404);
    const dns = await manageDomains(new Request(`https://cloudmail.invalid/domains/${id}/dns`), { zoneId: found.zoneId, accessToken });
    if (!dns.ok) return json({ message: 'Cloudflare DNS records could not be retrieved' }, 502);
    const records = await dns.json() as { data?: unknown; result_info?: { total_pages?: number } };
    if (!Array.isArray(records.data)) return json({ message: 'Invalid Cloudflare DNS response' }, 502);
    return json({ id: found.domain.tag, name: found.domain.name, status: 'unknown', zone_id: found.zoneId, enabled: found.domain.enabled, ...(found.domain.created && { created_at: found.domain.created }), records: records.data, records_incomplete: Number(records.result_info?.total_pages) > 1 });
  } catch { return json({ message: 'Cloudflare domain could not be retrieved' }, 502); }
}

export async function deleteDomain(request: Request, env: { DB: D1Database; BETTER_AUTH_SECRET: string; CLOUDFLARE_OAUTH_CLIENT_ID?: string }, userId: string): Promise<Response> {
  const url = new URL(request.url);
  const lookup = await getDomain(new Request(url, { method: 'GET' }), env, userId);
  if (!lookup.ok) return lookup;
  const domain = await lookup.json() as { id: string; zone_id: string };
  try {
    const response = await manageSelectedZoneDomains(new Request(`https://cloudmail.invalid/api/cloudflare/zones/${domain.zone_id}/domains/${domain.id}`, { method: 'DELETE' }), env, userId);
    if (!response.ok) return Response.json({ message: 'Cloudflare domain deletion could not be confirmed; check before retrying' }, { status: 502, headers: { 'cache-control': 'no-store' } });
    return Response.json({ id: domain.id, deleted: true }, { headers: { 'cache-control': 'no-store' } });
  } catch { return Response.json({ message: 'Cloudflare domain deletion could not be confirmed; check before retrying' }, { status: 502, headers: { 'cache-control': 'no-store' } }); }
}
