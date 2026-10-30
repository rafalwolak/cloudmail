export interface CloudflareZone {
  id: string;
  name: string;
  status: string;
  account: { id: string; name: string };
}

export async function listCloudflareZones(accessToken: string, page: number): Promise<{ data: CloudflareZone[]; page: number; totalPages: number }> {
  if (!accessToken || !Number.isSafeInteger(page) || page < 1) throw new Error('Invalid Cloudflare zone request');
  const url = new URL('https://api.cloudflare.com/client/v4/zones');
  url.search = new URLSearchParams({ page: String(page), per_page: '50', order: 'name' }).toString();
  let response: Response;
  try { response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(10000) }); }
  catch { throw new Error('Cloudflare zones could not be retrieved'); }
  if (!response.ok) throw new Error('Cloudflare zones could not be retrieved');
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error('Invalid Cloudflare zones response'); }
  if (!body || typeof body !== 'object' || !('success' in body) || body.success !== true || !('result' in body) || !Array.isArray(body.result) || !('result_info' in body) || !body.result_info || typeof body.result_info !== 'object' || !('page' in body.result_info) || body.result_info.page !== page || !('total_pages' in body.result_info) || !Number.isSafeInteger(body.result_info.total_pages) || Number(body.result_info.total_pages) < 0) throw new Error('Invalid Cloudflare zones response');
  const data: CloudflareZone[] = body.result.map((zone: unknown) => {
    if (!zone || typeof zone !== 'object' || !('id' in zone) || typeof zone.id !== 'string' || !/^[a-f0-9]{32}$/i.test(zone.id) || !('name' in zone) || typeof zone.name !== 'string' || !('status' in zone) || typeof zone.status !== 'string' || !('account' in zone) || !zone.account || typeof zone.account !== 'object' || !('id' in zone.account) || typeof zone.account.id !== 'string' || !('name' in zone.account) || typeof zone.account.name !== 'string') throw new Error('Invalid Cloudflare zones response');
    return { id: zone.id, name: zone.name, status: zone.status, account: { id: zone.account.id, name: zone.account.name } };
  });
  return { data, page, totalPages: Number(body.result_info.total_pages) };
}
