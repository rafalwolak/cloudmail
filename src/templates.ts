import type { AuthEnv } from './auth';

type Variable = { key: string; type: 'string' | 'number'; fallback_value?: string | number };
type Template = { alias?: string | null; name: string; html: string; text?: string; from?: string; subject?: string; reply_to?: string; variables?: Variable[] };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keyPattern = /^[A-Z][A-Z0-9_]{0,63}$/;

function validateTemplate(value: unknown): value is Template {
  if (!object(value) || Object.keys(value).some(key => !['name', 'html', 'text', 'from', 'subject', 'reply_to', 'variables', 'alias'].includes(key))) return false;
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100 || typeof value.html !== 'string' || !value.html.trim() || value.html.length > 200000) return false;
  if (value.alias != null && (typeof value.alias !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(value.alias) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.alias))) return false;
  for (const key of ['text', 'from', 'subject', 'reply_to']) if (value[key] !== undefined && typeof value[key] !== 'string') return false;
  if (value.variables !== undefined) {
    if (!Array.isArray(value.variables) || value.variables.length > 100) return false;
    const keys = new Set<string>();
    for (const variable of value.variables) {
      if (!object(variable) || Object.keys(variable).some(key => !['key', 'type', 'fallback_value'].includes(key)) || typeof variable.key !== 'string' || !keyPattern.test(variable.key) || keys.has(variable.key) || !['string', 'number'].includes(String(variable.type))) return false;
      if (variable.fallback_value !== undefined && (typeof variable.fallback_value !== variable.type || (typeof variable.fallback_value === 'number' && !Number.isFinite(variable.fallback_value)))) return false;
      keys.add(variable.key);
    }
  }
  const allowed = new Set((value.variables as Variable[] | undefined)?.map(variable => variable.key) ?? []);
  for (const field of ['html', 'text', 'subject'] as const) {
    const content = value[field];
    if (typeof content === 'string') for (const match of content.matchAll(/\{\{\{([A-Z][A-Z0-9_]*)\}\}\}/g)) if (!allowed.has(match[1])) return false;
  }
  return true;
}

interface TemplateRow { id: string; draft: string; published: string | null; created_at: string; updated_at: string }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
const format = (row: TemplateRow) => ({ id: row.id, ...JSON.parse(row.draft), status: row.published ? 'published' : 'draft', created_at: row.created_at, updated_at: row.updated_at });

export async function handleTemplates(request: Request, env: AuthEnv): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const match = path.match(/^\/templates\/([a-z0-9_-]{1,64})(?:\/(publish|duplicate))?$/);
  const reference = match?.[1];
  if (path === '/templates' && request.method === 'GET') {
    const params = url.searchParams;
    if ([...params.keys()].some(key => !['limit', 'before', 'after'].includes(key)) || ['limit', 'before', 'after'].some(key => params.getAll(key).length > 1)) return json({ message: 'Unsupported or duplicate query parameter' }, 400);
    const raw = params.get('limit') ?? '20';
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 100) return json({ message: 'limit must be between 1 and 100' }, 400);
    const before = params.get('before'); const after = params.get('after');
    if ((before !== null && after !== null) || before === '' || after === '') return json({ message: 'Provide only one valid cursor' }, 400);
    const cursor = before ?? after;
    let condition = ''; let values: (string | number)[] = [];
    if (cursor !== null) {
      const anchor = await env.DB.prepare('SELECT id, created_at FROM templates WHERE id = ?').bind(cursor).first<{ id: string; created_at: string }>();
      if (!anchor) return json({ message: 'Invalid cursor' }, 400);
      condition = before !== null ? 'WHERE (created_at, id) > (?, ?)' : 'WHERE (created_at, id) < (?, ?)';
      values = [anchor.created_at, anchor.id];
    }
    const direction = before !== null ? 'ASC' : 'DESC'; const limit = Number(raw);
    const rows = await env.DB.prepare(`SELECT * FROM templates ${condition} ORDER BY created_at ${direction}, id ${direction} LIMIT ?`).bind(...values, limit + 1).all<TemplateRow>();
    const result = rows.results.slice(0, limit);
    if (before !== null) result.reverse();
    return json({ object: 'list', data: result.map(format), has_more: rows.results.length > limit });
  }
  if (path === '/templates' && request.method === 'POST') {
    let body: unknown; try { body = await request.json(); } catch { return json({ message: 'Invalid JSON' }, 400); }
    if (!validateTemplate(body)) return json({ message: 'Invalid template' }, 400);
    const newId = crypto.randomUUID(); const now = new Date().toISOString();
    await env.DB.prepare('INSERT INTO templates (id, draft, created_at, updated_at) VALUES (?, ?, ?, ?)').bind(newId, JSON.stringify(body), now, now).run();
    return json({ id: newId });
  }
  if (!reference) return json({ message: 'Not found' }, 404);
  const row = await env.DB.prepare("SELECT * FROM templates WHERE id = ? OR json_extract(published, '$.alias') = ?").bind(reference, reference).first<TemplateRow>();
  if (!row) return json({ message: 'Not found' }, 404);
  const id = row.id;
  if (match?.[2] === 'duplicate' && request.method === 'POST') {
    const draft: Template = JSON.parse(row.draft);
    const { alias: _alias, ...rest } = draft;
    const copy = { ...rest, name: `${draft.name.slice(0, 93)} (copy)` };
    const newId = crypto.randomUUID(); const now = new Date().toISOString();
    await env.DB.prepare('INSERT INTO templates (id, draft, created_at, updated_at) VALUES (?, ?, ?, ?)').bind(newId, JSON.stringify(copy), now, now).run();
    return json({ object: 'template', id: newId });
  }
  if (match?.[2] === 'publish' && request.method === 'POST') {
    const result = await env.DB.prepare("UPDATE templates SET published = draft, updated_at = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM templates other WHERE other.id != ? AND json_extract(other.published, '$.alias') = json_extract((SELECT draft FROM templates WHERE id = ?), '$.alias'))").bind(new Date().toISOString(), id, id, id).run();
    if (!result.meta.changes) return json({ message: 'Template alias is already published' }, 409);
    return json({ id });
  }
  if (match?.[2]) return json({ message: 'Not found' }, 404);
  if (request.method === 'GET') return json(format(row));
  if (request.method === 'DELETE') { await env.DB.prepare('DELETE FROM templates WHERE id = ?').bind(id).run(); return json({ object: 'template', id, deleted: true }); }
  if (request.method === 'PATCH') {
    let changes: unknown; try { changes = await request.json(); } catch { return json({ message: 'Invalid JSON' }, 400); }
    if (!object(changes)) return json({ message: 'Invalid template' }, 400);
    const draft = { ...JSON.parse(row.draft), ...changes };
    if (!validateTemplate(draft)) return json({ message: 'Invalid template' }, 400);
    await env.DB.prepare('UPDATE templates SET draft = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(draft), new Date().toISOString(), id).run();
    return json({ id });
  }
  return json({ message: 'Not found' }, 404);
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
export async function resolveTemplate(value: unknown, env: AuthEnv): Promise<unknown | string> {
  if (!object(value) || !Object.hasOwn(value, 'template')) return value;
  const ref = value.template;
  if (!object(ref) || Object.keys(ref).some(key => !['id', 'variables'].includes(key)) || typeof ref.id !== 'string' || (ref.variables !== undefined && !object(ref.variables)) || value.html !== undefined || value.text !== undefined) return 'Invalid template reference';
  const row = await env.DB.prepare("SELECT published FROM templates WHERE id = ? OR json_extract(published, '$.alias') = ?").bind(ref.id, ref.id).first<{ published: string | null }>();
  if (!row?.published) return 'Template not found or not published';
  const template: Template = JSON.parse(row.published);
  const input = (ref.variables ?? {}) as Record<string, unknown>;
  const declarations = template.variables ?? [];
  if (Object.keys(input).some(key => !declarations.some(variable => variable.key === key))) return 'Unknown template variable';
  const values: Record<string, string> = Object.create(null);
  for (const variable of declarations) {
    const current = Object.hasOwn(input, variable.key) ? input[variable.key] : variable.fallback_value;
    if (typeof current !== variable.type || (typeof current === 'number' && !Number.isFinite(current))) return `Missing or invalid template variable: ${variable.key}`;
    values[variable.key] = String(current);
  }
  const render = (content: string, html: boolean) => content.replace(/\{\{\{([A-Z][A-Z0-9_]*)\}\}\}/g, (_, key: string) => html ? escapeHtml(values[key]) : values[key]);
  const { template: _reference, ...fields } = value;
  return { ...fields, from: fields.from ?? template.from, subject: typeof fields.subject === 'string' ? fields.subject : template.subject ? render(template.subject, false) : undefined, reply_to: fields.reply_to ?? template.reply_to, html: render(template.html, true), ...(template.text !== undefined && { text: render(template.text, false) }) };
}
