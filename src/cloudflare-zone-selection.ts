export async function addCloudflareZone(db: D1Database, userId: string, accessToken: string, zoneId: string): Promise<{ id: string; name: string }> {
  if (!accessToken || !/^[0-9a-f]{32}$/i.test(zoneId)) throw new Error('Invalid Cloudflare zone');
  let response: Response;
  try {
    response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}`, { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(10000) });
  } catch { throw new Error('Cloudflare zone could not be verified'); }
  if (!response.ok) throw new Error('Cloudflare zone could not be verified');
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error('Invalid Cloudflare zone response'); }
  if (!body || typeof body !== 'object' || !('success' in body) || body.success !== true || !('result' in body) || !body.result || typeof body.result !== 'object') throw new Error('Invalid Cloudflare zone response');
  const zone = body.result;
  if (!('id' in zone) || typeof zone.id !== 'string' || zone.id.toLowerCase() !== zoneId.toLowerCase() || !('name' in zone) || typeof zone.name !== 'string' || !zone.name || !('account' in zone) || !zone.account || typeof zone.account !== 'object' || !('id' in zone.account) || typeof zone.account.id !== 'string' || !zone.account.id) throw new Error('Invalid Cloudflare zone response');
  await db.prepare('INSERT INTO cloudflare_zones (user_id, zone_id, name, account_id) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, zone_id) DO UPDATE SET name = excluded.name, account_id = excluded.account_id').bind(userId, zone.id.toLowerCase(), zone.name, zone.account.id).run();
  return { id: zone.id.toLowerCase(), name: zone.name };
}

export async function listSelectedCloudflareZones(db: D1Database, userId: string): Promise<{ id: string; name: string; account_id: string }[]> {
  const result = await db.prepare('SELECT zone_id AS id, name, account_id FROM cloudflare_zones WHERE user_id = ? ORDER BY name, zone_id').bind(userId).all<{ id: string; name: string; account_id: string }>();
  return result.results;
}
