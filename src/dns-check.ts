type RecordData = { type: string; name: string; content: string; priority?: number };
type Check = RecordData & { status: 'match' | 'missing' | 'different' | 'unknown' };
const types: Record<string, number> = { A: 1, NS: 2, CNAME: 5, MX: 15, TXT: 16 };
const canonical = (value: string) => value.replace(/\.$/, '').toLowerCase();

function textValue(value: string): string | null {
  if (!value.startsWith('"')) return value;
  const pieces = [...value.matchAll(/"((?:\\.|[^"\\])*)"/g)];
  if (!pieces.length || value.replace(/"(?:\\.|[^"\\])*"/g, '').trim()) return null;
  return pieces.map(piece => piece[1].replace(/\\(\d{3}|.)/g, (_, escaped: string) => /^\d{3}$/.test(escaped) ? String.fromCharCode(Number(escaped)) : escaped)).join('');
}

function matches(record: RecordData, answer: string): boolean {
  if (record.type === 'TXT') { const actual = textValue(answer); return actual !== null && actual === textValue(record.content); }
  if (record.type === 'MX') {
    const parts = answer.trim().split(/\s+/);
    const expected = record.content.trim().split(/\s+/);
    const priority = record.priority ?? (expected.length === 2 ? Number(expected.shift()) : undefined);
    return parts.length === 2 && priority !== undefined && Number(parts[0]) === priority && canonical(parts[1]) === canonical(expected[0]);
  }
  return canonical(answer) === canonical(record.content);
}

export async function checkPublicDns(records: RecordData[], resolve: typeof fetch = fetch): Promise<Check[]> {
  return Promise.all(records.map(async record => {
    const unknown: Check = { ...record, status: 'unknown' };
    const type = types[record.type];
    const name = canonical(record.name);
    if (!type || name.length > 253 || !name.split('.').every(label => /^[a-z0-9_-]{1,63}$/.test(label))) return unknown;
    const url = new URL('https://cloudflare-dns.com/dns-query');
    url.searchParams.set('name', name); url.searchParams.set('type', record.type);
    try {
      const response = await resolve(url, { headers: { accept: 'application/dns-json' }, redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (!response.ok) return unknown;
      const body = await response.json() as { Status?: number; TC?: boolean; Answer?: { name?: string; type?: number; data?: string }[] };
      if (body.TC || (body.Status !== 0 && body.Status !== 3) || (body.Answer !== undefined && !Array.isArray(body.Answer))) return unknown;
      if (body.Answer?.some(answer => !answer || typeof answer.name !== 'string' || typeof answer.type !== 'number' || typeof answer.data !== 'string')) return unknown;
      const all = body.Answer ?? []; const owners = new Set([name]);
      if (type !== types.CNAME) {
        let owner = name;
        for (let i = 0; i < 16; i++) {
          const aliases = all.filter(answer => answer.type === types.CNAME && canonical(answer.name!) === owner);
          if (!aliases.length) break;
          if (aliases.length !== 1) return unknown;
          const target = canonical(aliases[0].data!);
          if (!target || owners.has(target)) return unknown;
          owners.add(target); owner = target;
          if (i === 15 && all.some(answer => answer.type === types.CNAME && canonical(answer.name!) === owner)) return unknown;
        }
      }
      const answers = all.filter(answer => owners.has(canonical(answer.name!)) && answer.type === type);
      return { ...record, status: answers.length === 0 ? 'missing' : answers.some(answer => matches(record, answer.data!)) ? 'match' : 'different' };
    } catch { return unknown; }
  }));
}
