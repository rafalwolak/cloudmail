export async function attachmentForAgent(result: Response) {
  if (!result.ok) return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(await result.json()) }] };
  const tooLarge = () => ({ isError: true, content: [{ type: 'text' as const, text: 'Attachment exceeds the 1 MiB MCP size limit; download it through the authenticated API.' }] });
  if (Number(result.headers.get('content-length')) > 1024 * 1024) return tooLarge();
  const data = new Uint8Array(await result.arrayBuffer());
  if (data.byteLength > 1024 * 1024) return tooLarge();
  let binary = '';
  for (let offset = 0; offset < data.length; offset += 8192) binary += String.fromCharCode(...data.subarray(offset, offset + 8192));
  return { content: [{ type: 'text' as const, text: JSON.stringify({ content_base64: btoa(binary), size: data.length }) }] };
}
