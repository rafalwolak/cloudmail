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
}

const allowedFields = new Set(['from', 'to', 'subject', 'text', 'html', 'cc', 'bcc', 'reply_to', 'headers']);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const addresses = (value: unknown): value is Addresses => nonempty(value) || (Array.isArray(value) && value.length > 0 && value.every(nonempty));

export function parseEmail(value: unknown): OutboundEmail | string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Invalid email';
  const email = value as Record<string, unknown>;
  const unsupported = Object.keys(email).filter(key => !allowedFields.has(key));
  if (unsupported.length) return `Unsupported fields: ${unsupported.join(', ')}`;
  if (!nonempty(email.from) || !addresses(email.to) || !nonempty(email.subject) || (!nonempty(email.text) && !nonempty(email.html))) return 'from, to, subject and text or html are required';
  if ((email.text !== undefined && typeof email.text !== 'string') || (email.html !== undefined && typeof email.html !== 'string')) return 'text and html must be strings';
  if (email.cc !== undefined && !addresses(email.cc)) return 'Invalid cc';
  if (email.bcc !== undefined && !addresses(email.bcc)) return 'Invalid bcc';
  if (email.reply_to !== undefined && !nonempty(email.reply_to)) return 'reply_to must be a single address';
  if (email.headers !== undefined && (!email.headers || typeof email.headers !== 'object' || Array.isArray(email.headers) || !Object.values(email.headers).every(value => typeof value === 'string'))) return 'headers must contain string values';
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
  };
}
