import { attachmentIndex, type AttachmentDirection } from './attachment-id';
import { sdkAttachmentMetadata, type AttachmentEnv, type LegacyAttachment } from './attachment-download';

type Dispatch = (request: Request) => Promise<Response>;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const errorNames: Record<number, string> = { 400: 'validation_error', 401: 'invalid_api_key', 403: 'restricted_api_key', 404: 'not_found', 405: 'method_not_allowed', 409: 'resource_locked', 422: 'validation_error', 429: 'rate_limit_exceeded', 503: 'service_unavailable' };
async function sdkError(response: Response): Promise<Response> {
  if (response.ok) return response;
  const body = await response.json() as { message: string; name?: string };
  return json({ ...body, name: body.name ?? errorNames[response.status] ?? 'application_error', statusCode: response.status }, response.status);
}

export async function handleResendApi(request: Request, env: AttachmentEnv, dispatch: Dispatch): Promise<Response> {
  const url = new URL(request.url); url.pathname = url.pathname.slice('/v1'.length);
  if (!/^\/(?:emails|templates|domains|api-keys|webhooks)(?:\/|$)/.test(url.pathname)) return sdkError(json({ message: 'Not found' }, 404));
  const attachment = url.pathname.match(/^\/emails\/(receiving\/)?([0-9a-f-]{36})\/attachments(?:\/([^/]+))?$/);
  if (request.method === 'GET' && attachment) {
    const direction: AttachmentDirection = attachment[1] ? 'receiving' : 'sending';
    const list = new URL(url); list.pathname = `/emails/${attachment[1] ?? ''}${attachment[2]}/attachments`;
    let requestedIndex: number | null = null;
    if (attachment[3]) {
      // Go through the same authorization gate even when the requested ID or cursor is invalid.
      list.search = '?limit=1';
      requestedIndex = await attachmentIndex(direction, attachment[2], attachment[3]);
      if (requestedIndex !== null && requestedIndex > 0) list.searchParams.set('after', String(requestedIndex - 1));
    } else {
      for (const name of ['before', 'after']) {
        const value = url.searchParams.get(name);
        if (value !== null && url.searchParams.getAll(name).length === 1) {
          const index = await attachmentIndex(direction, attachment[2], value);
          list.searchParams.set(name, index === null ? 'invalid' : String(index));
        }
      }
    }
    const result = await dispatch(new Request(list, request));
    if (!result.ok) {
      if (attachment[3] && result.status === 400) return sdkError(json({ message: 'Not found' }, 404));
      return sdkError(result);
    }
    if (attachment[3] && (requestedIndex === null || url.search)) return sdkError(json({ message: url.search ? 'Unsupported query parameter' : 'Not found' }, url.search ? 400 : 404));
    const body = await result.json() as { data: LegacyAttachment[]; has_more: boolean };
    const data = await Promise.all(body.data.map(item => sdkAttachmentMetadata(direction, attachment[2], item, env)));
    if (data.some(item => item === null)) return sdkError(json({ message: 'Signed downloads are not configured' }, 503));
    if (attachment[3]) return data.length ? json({ object: 'attachment', ...data[0] }) : sdkError(json({ message: 'Not found' }, 404));
    return json({ object: 'list', has_more: body.has_more, data });
  }
  const response = await dispatch(new Request(url, request));
  if (!response.ok) return sdkError(response);
  if (response.status === 204) return json({ id: url.pathname.split('/').at(-1) });
  const detail = url.pathname.match(/^\/emails\/(receiving\/)?([0-9a-f-]{36})$/);
  if (request.method === 'GET' && detail) {
    const body = await response.json() as { attachments: LegacyAttachment[] | null; to: string | string[] };
    const direction = detail[1] ? 'receiving' : 'sending';
    const attachments = body.attachments ? await Promise.all(body.attachments.map(item => sdkAttachmentMetadata(direction, detail[2], item, env, false))) : body.attachments;
    return json({ ...body, object: 'email', ...(detail[1] && { to: Array.isArray(body.to) ? body.to : [body.to] }), attachments });
  }
  return response;
}
