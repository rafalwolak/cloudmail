import mime from 'mime';

export type Addresses = string | string[];
export interface OutboundEmail {
  from: string;
  to: Addresses;
  subject: string;
  text?: string;
  html?: string;
  cc?: Addresses;
  bcc?: Addresses;
  replyTo?: string;
  headers?: Record<string, string>;
  attachments?: Attachment[];
  tags?: { name: string; value: string }[];
}

interface Attachment { filename: string; content: string; type: string; disposition: 'attachment' | 'inline'; contentId?: string }

const allowedFields = new Set(['from', 'to', 'subject', 'text', 'html', 'cc', 'bcc', 'reply_to', 'headers', 'attachments', 'tags']);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const addresses = (value: unknown): value is Addresses => nonempty(value) || (Array.isArray(value) && value.length > 0 && value.every(nonempty));

function parseAttachments(value: unknown): Attachment[] | null {
  if (!Array.isArray(value) || value.length > 32) return null;
  const result: Attachment[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const attachment = item as Record<string, unknown>;
    if (Object.keys(attachment).some(key => !['filename', 'content', 'content_type', 'content_id'].includes(key))) return null;
    if (!nonempty(attachment.filename) || typeof attachment.content !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(attachment.content)) return null;
    if (attachment.content_type !== undefined && !nonempty(attachment.content_type)) return null;
    if (attachment.content_id !== undefined && !nonempty(attachment.content_id)) return null;
    result.push({
      filename: attachment.filename,
      content: attachment.content,
      type: typeof attachment.content_type === 'string' ? attachment.content_type : mime.getType(attachment.filename) ?? 'application/octet-stream',
      disposition: attachment.content_id === undefined ? 'attachment' : 'inline',
      ...(typeof attachment.content_id === 'string' && { contentId: attachment.content_id }),
    });
  }
  return result;
}

export function parseEmail(value: unknown): OutboundEmail | string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Invalid email';
  const email = value as Record<string, unknown>;
  const unsupported = Object.keys(email).filter(key => !allowedFields.has(key));
  if (unsupported.length) return `Unsupported fields: ${unsupported.join(', ')}`;
  if (!nonempty(email.from) || !addresses(email.to) || !nonempty(email.subject) || (!nonempty(email.text) && !nonempty(email.html))) return 'from, to, subject and text or html are required';
  if ([...email.subject].length > 998 || /[\r\n]/.test(email.subject)) return 'subject must be at most 998 characters and contain no line breaks';
  if ((email.text !== undefined && typeof email.text !== 'string') || (email.html !== undefined && typeof email.html !== 'string')) return 'text and html must be strings';
  if (email.cc !== undefined && !addresses(email.cc)) return 'Invalid cc';
  if (email.bcc !== undefined && !addresses(email.bcc)) return 'Invalid bcc';
  if (email.reply_to !== undefined && !nonempty(email.reply_to)) return 'reply_to must be a single address';
  if (email.headers !== undefined && (!email.headers || typeof email.headers !== 'object' || Array.isArray(email.headers) || !Object.values(email.headers).every(value => typeof value === 'string'))) return 'headers must contain string values';
  if (email.headers !== undefined) {
    const headers = email.headers as Record<string, string>;
    const entries = Object.entries(headers); const encoder = new TextEncoder();
    const names = new Set<string>(); let standardCount = 0;
    for (const [name, value] of entries) {
      const normalized = name.toLowerCase(); const custom = normalized.startsWith('x-');
      if (names.has(normalized) || name.length > 100 || !(custom ? /^x-[a-z0-9_-]+$/i : /^[a-z0-9-]+$/i).test(name) || !value.length || /[\r\n]/.test(value) || encoder.encode(value).byteLength > 2048) return 'Invalid custom header name or value';
      names.add(normalized); if (!custom) standardCount++;
    }
    if (standardCount > 20) return 'A maximum of 20 non-X custom headers is supported';
    const bytes = encoder.encode(entries.map(([name, value]) => `${name}: ${value}\r\n`).join('')).byteLength;
    if (bytes > 16000) return 'Custom headers exceed 16 KB';
  }
  if (email.tags !== undefined && (!Array.isArray(email.tags) || email.tags.length > 100 || !email.tags.every(tag => tag && typeof tag === 'object' && !Array.isArray(tag) && Object.keys(tag).length === 2 && typeof tag.name === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(tag.name) && typeof tag.value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(tag.value)))) return 'Invalid tags';
  const attachments = email.attachments === undefined ? undefined : parseAttachments(email.attachments);
  if (attachments === null) return 'Invalid attachments: use up to 32 base64-encoded files';
  const count = (v: unknown) => Array.isArray(v) ? v.length : v === undefined ? 0 : 1;
  if (count(email.to) + count(email.cc) + count(email.bcc) > 50) return 'A maximum of 50 recipients is supported';
  return {
    from: email.from, to: email.to, subject: email.subject,
    ...(typeof email.text === 'string' && { text: email.text }),
    ...(typeof email.html === 'string' && { html: email.html }),
    ...(addresses(email.cc) && { cc: email.cc }),
    ...(addresses(email.bcc) && { bcc: email.bcc }),
    ...(nonempty(email.reply_to) && { replyTo: email.reply_to }),
    ...(email.headers !== undefined && { headers: email.headers as Record<string, string> }),
    ...(attachments !== undefined && { attachments }),
    ...(Array.isArray(email.tags) && { tags: email.tags }),
  };
}

// Scoped keys accept an unambiguous mailbox and only headers that cannot alter sender identity.
export function allowedSender(email: OutboundEmail, domain: string | null): boolean {
  if (!domain) return true;
  if (email.headers && Object.keys(email.headers).some(name => !['in-reply-to', 'references'].includes(name.toLowerCase()))) return false;
  const match = email.from.match(/^[A-Za-z0-9!#$%&'*+\/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+\/=?^_`{|}~-]+)*@([A-Za-z0-9.-]+)$/);
  return !!match && match[1].toLowerCase() === domain;
}
