import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { parseEmail } from './email';
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
      attachments: z.array(z.object({ filename: z.string(), content: z.string(), content_type: z.string().optional(), content_id: z.string().optional() }).strict()).optional(),
    }).strict(),
    annotations: { destructiveHint: false, readOnlyHint: false, idempotentHint: false, openWorldHint: true },
  }, async args => {
    const email = parseEmail(args);
    if (typeof email === 'string') return { isError: true, content: [{ type: 'text', text: email }] };
    try {
      const result = await env.EMAIL.send(email);
      return { content: [{ type: 'text', text: JSON.stringify({ id: result.messageId }) }] };
    } catch {
      return { isError: true, content: [{ type: 'text', text: 'Email could not be sent. Check the sending domain and Cloudflare configuration.' }] };
    }
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}
