// Keep in sync with the MCP SDK's supported protocol versions.
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'];

export async function discovery(request: Request, configuredUrl: string): Promise<Response> {
  let origin: string;
  try {
    const url = new URL(configuredUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid URL');
    origin = url.origin;
  } catch { return Response.json({ message: 'Public origin is not configured' }, { status: 503 }); }
  const card = new URL(request.url).pathname === '/mcp/server-card';
  const headers = new Headers({
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'Content-Type, If-None-Match',
    'access-control-expose-headers': 'ETag',
    'cache-control': 'public, max-age=300',
    'content-type': card ? 'application/mcp-server-card+json' : 'application/ai-catalog+json',
    'x-content-type-options': 'nosniff',
  });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET, OPTIONS' } });
  const body = JSON.stringify(card ? {
    $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
    name: 'pro.design4/cloudmail', version: '0.1.0', title: 'Cloudmail',
    description: 'Transactional email on Cloudflare Workers.',
    websiteUrl: 'https://github.com/rafalwolak/cloudmail',
    remotes: [{ type: 'streamable-http', url: `${origin}/mcp`, supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
      headers: [{ name: 'Authorization', description: 'Bearer followed by a Cloudmail API key.', isRequired: true, isSecret: true }] }],
  } : {
    specVersion: '1.0', host: { displayName: 'Cloudmail' },
    entries: [{ identifier: 'urn:air:design4.pro:mcp:cloudmail', displayName: 'Cloudmail MCP', type: 'application/mcp-server-card+json', url: `${origin}/mcp/server-card` }],
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const etag = `"${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}"`;
  headers.set('etag', etag);
  if (request.headers.get('if-none-match')?.split(',').some(value => value.trim().replace(/^W\//, '') === etag || value.trim() === '*')) return new Response(null, { status: 304, headers });
  return new Response(body, { headers });
}
