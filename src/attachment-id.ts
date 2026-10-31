export type AttachmentDirection = 'sending' | 'receiving';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function attachmentId(direction: AttachmentDirection, emailId: string, index: number): Promise<string> {
  if (!Number.isInteger(index) || index < 0 || index > 0xffffffff) throw new RangeError('Invalid attachment index');
  // UUIDv8 retains 90 scoped digest bits and a reversible 32-bit index. It is not an access token.
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(['cloudmail:attachment-id:v1', direction, emailId, index])));
  const bytes = new Uint8Array(hash.slice(0, 16)); new DataView(bytes.buffer).setUint32(12, index);
  bytes[6] = (bytes[6] & 0x0f) | 0x80; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function attachmentIndex(direction: AttachmentDirection, emailId: string, id: string): Promise<number | null> {
  if (!uuid.test(id)) return null;
  const index = Number.parseInt(id.slice(-8), 16);
  return await attachmentId(direction, emailId, index) === id.toLowerCase() ? index : null;
}
