export async function cleanCanceledArchives(db: D1Database, bucket: R2Bucket): Promise<void> {
  const rows = await db.prepare("SELECT id FROM scheduled_emails WHERE state = 'canceled' AND archive_cleanup_pending = 1 LIMIT 20").all<{ id: string }>();
  for (const { id } of rows.results) {
    try {
      await bucket.delete(`sent/${id}`);
      await db.batch([
        db.prepare("UPDATE email_history SET body_stored = 0 WHERE id = ? AND EXISTS (SELECT 1 FROM scheduled_emails WHERE id = ? AND state = 'canceled')").bind(id, id),
        db.prepare("UPDATE scheduled_emails SET archive_cleanup_pending = 0 WHERE id = ? AND state = 'canceled'").bind(id),
      ]);
    } catch { console.error('Could not remove canceled email archive; cleanup will retry'); }
  }
}

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
