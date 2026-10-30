const MAX_FORM_BYTES = 3_000_000;

export async function previewToken(secret: string, sessionId: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`template-preview:${sessionId}`));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function previewTemplate(request: Request, expectedToken: string): Promise<Response> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/x-www-form-urlencoded')) return Response.json({ message: 'Invalid content type' }, { status: 415 });
  if (!request.body) return Response.json({ message: 'Missing content' }, { status: 400 });
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_FORM_BYTES) { await reader.cancel(); return Response.json({ message: 'Preview is too large' }, { status: 413 }); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const form = new URLSearchParams(new TextDecoder().decode(bytes));
  const values = form.getAll('html'); const tokens = form.getAll('token');
  if (tokens.length !== 1 || tokens[0].length !== expectedToken.length) return Response.json({ message: 'Invalid preview token' }, { status: 403 });
  let mismatch = 0;
  for (let i = 0; i < expectedToken.length; i++) mismatch |= tokens[0].charCodeAt(i) ^ expectedToken.charCodeAt(i);
  if (mismatch) return Response.json({ message: 'Invalid preview token' }, { status: 403 });
  if (values.length !== 1 || [...form.keys()].some(key => key !== 'html' && key !== 'token') || values[0].length > 200000) return Response.json({ message: 'Invalid preview content' }, { status: 400 });
  return new Response(values[0], { headers: {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
    'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
  } });
}
