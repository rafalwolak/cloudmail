import { convert } from 'html-to-text';
import type { OutboundEmail } from './email';

export function withPlainText(email: OutboundEmail): OutboundEmail {
  if (email.text !== undefined || !email.html) return email;
  return { ...email, text: convert(email.html, { wordwrap: false }) };
}
