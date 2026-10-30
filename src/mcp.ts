import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { parseEmail } from './email';
import { IdempotencyConflict, readHistory, sendRecordedEmail } from './history';
import type { AuthEnv } from './auth';

const addresses = z.union([z.string(), z.array(z.string())]);

export async function handleMcp(request: Request, env: AuthEnv): Promise<Response> {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(env.BETTER_AUTH_URL).origin) return Response.json({ message: 'Invalid origin' }, { status: 403 });
  const server = new McpServer({ name: 'cloudmail', version: '0.1.0' });
  server.registerTool('send_email', {
    description: 'Send a transactional email. The sender domain must be configured in Cloudflare Email Service. Do not use for marketing email.',
    inputSchema: z.object({
      from: z.string(), to: addresses, subject: z.string(), text: z.string().optional(), html: z.string().optional(),
      cc: addresses.optional(), bcc: addresses.optional(), reply_to: z.string().optional(), headers: z.record(z.string(), z.string()).optional(),
      idempotency_key: z.string().min(1).max(256).optional(),
      attachments: z.array(z.object({ filename: z.string(), content: z.string(), content_type: z.string().optional(), content_id: z.string().optional() }).strict()).optional(),
    }).strict(),
    annotations: { destructiveHint: false, readOnlyHint: false, idempotentHint: false, openWorldHint: true },
  }, async args => {
    const { idempotency_key, ...payload } = args;
    const email = parseEmail(payload);
    if (typeof email === 'string') return { isError: true, content: [{ type: 'text', text: email }] };
    try {
      const result = await sendRecordedEmail(env, email, idempotency_key);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) {
      if (error instanceof IdempotencyConflict) return { isError: true, content: [{ type: 'text', text: error.code }] };
      return { isError: true, content: [{ type: 'text', text: 'Email could not be confirmed. Check history before retrying; delivery may be uncertain.' }] };
    }
  });
  const historyTool = async (path: string) => {
    const response = await readHistory(new Request(new URL(path, env.BETTER_AUTH_URL)), env);
    const body = await response.json();
    return { ...(response.ok ? {} : { isError: true }), content: [{ type: 'text' as const, text: JSON.stringify(body) }] };
  };
  server.registerTool('list_emails', {
    description: 'List recorded email attempts. Accepted means accepted by Cloudflare, not confirmed delivered.',
    inputSchema: z.object({ limit: z.number().int().min(1).max(100).optional(), before: z.string().optional(), after: z.string().optional() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async args => {
    const params = new URLSearchParams();
    if (args.limit !== undefined) params.set('limit', String(args.limit));
    if (args.before !== undefined) params.set('before', args.before);
    if (args.after !== undefined) params.set('after', args.after);
    return historyTool(`/emails?${params}`);
  });
  server.registerTool('get_email', {
    description: 'Retrieve metadata and status of a recorded email attempt.',
    inputSchema: z.object({ id: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ id }) => historyTool(`/emails/${encodeURIComponent(id)}`));
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}
