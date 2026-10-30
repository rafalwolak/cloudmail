import type { OutboundEmail } from './email';

type Content = { html: string | null; text: string | null; attachments: OutboundEmail['attachments'] | null };

// Authentication links must never be passed to this storage function.
export async function storeSentContent(bucket: R2Bucket, id: string, email: OutboundEmail): Promise<void> {
  const content: Content = { html: email.html ?? null, text: email.text ?? null, attachments: email.attachments ?? [] };
  await bucket.put(`sent/${id}`, JSON.stringify(content), { httpMetadata: { contentType: 'application/json' } });
}

export async function readSentContent(bucket: R2Bucket, id: string): Promise<Content | null> {
  const object = await bucket.get(`sent/${id}`);
  if (!object) return null;
  const value: unknown = await object.json();
  if (!value || typeof value !== 'object' || !('html' in value) || !('text' in value) || (value.html !== null && typeof value.html !== 'string') || (value.text !== null && typeof value.text !== 'string')) throw new Error('Invalid stored email content');
  const attachments = 'attachments' in value ? value.attachments : null;
  if (attachments !== null && (!Array.isArray(attachments) || attachments.some(item => !item || typeof item !== 'object' || typeof item.filename !== 'string' || typeof item.content !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.content) || typeof item.type !== 'string' || !['attachment', 'inline'].includes(item.disposition)))) throw new Error('Invalid stored attachments');
  return { html: value.html as string | null, text: value.text as string | null, attachments: attachments as Content['attachments'] };
}
