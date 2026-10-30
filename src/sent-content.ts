import type { OutboundEmail } from './email';

type Content = { html: string | null; text: string | null };

// Authentication links must never be passed to this storage function.
export async function storeSentContent(bucket: R2Bucket, id: string, email: OutboundEmail): Promise<void> {
  const content: Content = { html: email.html ?? null, text: email.text ?? null };
  await bucket.put(`sent/${id}`, JSON.stringify(content), { httpMetadata: { contentType: 'application/json' } });
}

export async function readSentContent(bucket: R2Bucket, id: string): Promise<Content | null> {
  const object = await bucket.get(`sent/${id}`);
  if (!object) return null;
  const value: unknown = await object.json();
  if (!value || typeof value !== 'object' || !('html' in value) || !('text' in value) || (value.html !== null && typeof value.html !== 'string') || (value.text !== null && typeof value.text !== 'string')) throw new Error('Invalid stored email content');
  return { html: value.html as string | null, text: value.text as string | null };
}
