export async function cleanOrphanedScheduledPayloads(db: D1Database, bucket: R2Bucket, now = Date.now()): Promise<void> {
  const state = await db.prepare('SELECT cursor FROM scheduled_cleanup_cursor WHERE id = 1').first<{ cursor: string | null }>();
  const page = await bucket.list({ prefix: 'scheduled/', limit: 20, ...(state?.cursor ? { cursor: state.cursor } : {}) });
  for (const object of page.objects) {
    if (!/^scheduled\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(object.key)) continue;
    if (object.uploaded.getTime() > now - 24 * 60 * 60 * 1000) continue;
    const reference = await db.prepare('SELECT id FROM scheduled_emails WHERE payload_r2_key = ? LIMIT 1').bind(object.key).first();
    if (!reference) await bucket.delete(object.key);
  }
  await db.prepare('UPDATE scheduled_cleanup_cursor SET cursor = ? WHERE id = 1').bind(page.truncated ? page.cursor : null).run();
}
