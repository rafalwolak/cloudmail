import type { AuthEnv } from './auth';
import { readHistory } from './history';
import { readReceived } from './inbound';
import { attachmentId, attachmentIndex, type AttachmentDirection } from './attachment-id';
import { createDownloadUrl, verifyDownloadUrl, privateDownloadHeaders } from './download-url';

export type AttachmentEnv = AuthEnv & { INBOUND: R2Bucket; ADMIN_EMAIL?: string };
export interface LegacyAttachment { id: string; filename: string | null; size: number; content_type: string; content_id?: string | null; content_disposition?: string | null }
const lifetime = 60 * 60;
const purpose = 'cloudmail:attachment-download:v1';
const json = (message: string, status: number) => Response.json({ message }, { status, headers: privateDownloadHeaders });

export async function sdkAttachmentMetadata(direction: AttachmentDirection, emailId: string, item: LegacyAttachment, env: AttachmentEnv, withDownload = true) {
  const id = await attachmentId(direction, emailId, Number(item.id));
  const metadata = { id, filename: item.filename, size: item.size, content_type: item.content_type, content_id: item.content_id ?? null, content_disposition: item.content_disposition ?? null };
  if (!withDownload) return metadata;
  const link = await createDownloadUrl(`/downloads/${direction}/${emailId}/attachments/${id}`, purpose, [direction, emailId, id], env, lifetime);
  return link ? { ...metadata, ...link } : null;
}

export async function downloadAttachment(request: Request, env: AttachmentEnv, now = Date.now()): Promise<Response> {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/downloads\/(sending|receiving)\/([0-9a-f-]{36})\/attachments\/([0-9a-f-]{36})$/);
  if (!match) return json('Not found', 404);
  if (!['GET', 'HEAD'].includes(request.method)) return Response.json({ message: 'Method not allowed' }, { status: 405, headers: { ...privateDownloadHeaders, allow: 'GET, HEAD' } });
  const direction = match[1] as AttachmentDirection;
  if (!await verifyDownloadUrl(request, purpose, [direction, match[2], match[3]], env, lifetime, now)) return json('Invalid or expired download link', 403);
  const index = await attachmentIndex(direction, match[2], match[3]);
  if (index === null) return json('Not found', 404);
  try {
    const path = `/emails/${direction === 'receiving' ? 'receiving/' : ''}${match[2]}/attachments/${index}`;
    const internal = new Request(new URL(path, env.BETTER_AUTH_URL));
    const response = direction === 'receiving' ? await readReceived(internal, env) : await readHistory(internal, env);
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(privateDownloadHeaders)) headers.set(name, value);
    if (request.method === 'HEAD') await response.body?.cancel();
    return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers });
  } catch { return json('Email content is unavailable', 503); }
}
