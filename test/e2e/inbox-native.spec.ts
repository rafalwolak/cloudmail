import { test, expect } from '@playwright/test';

// Native sessions and signed downloads must never be retained in failure traces.
test.use({ trace: 'off' });

test('verified administrator downloads native received MIME through the real dashboard', async ({ page }, testInfo) => {
  test.skip(!process.env.TEST_DASHBOARD_ADMIN || process.env.TEST_INBOUND !== 'true', 'Requires the disposable verified administrator and native Email Routing profile');
  const { injectReceivedFixture } = await import('../received-fixture.mjs');
  const base = String(testInfo.project.use.baseURL);
  const marker = await injectReceivedFixture(base);
  const headers = { authorization: `Bearer ${process.env.TEST_API_KEY || 'local-test-key'}` };
  const listing = await fetch(`${base}/emails/receiving?subject=${encodeURIComponent(marker)}`, { headers });
  expect(listing.status).toBe(200);
  const { data } = await listing.json(); expect(data).toHaveLength(1); const id = data[0].id;
  try {
    // Authenticate outside Playwright action logs; never retain credentials or signed URLs in a trace.
    const login = await fetch(`${base}/api/auth/sign-in/email`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ email: process.env.TEST_DASHBOARD_ADMIN, password: process.env.TEST_DASHBOARD_PASSWORD }) });
    expect(login.status).toBe(200);
    const session = login.headers.get('set-cookie')?.split(';')[0];
    if (!session) throw new Error('Local administrator session was not issued');
    const split = session.indexOf('=');
    await page.context().addCookies([{ name: session.slice(0, split), value: session.slice(split + 1), url: base, httpOnly: true, sameSite: 'Lax' }]);
    await page.goto('/dashboard/inbox');
    await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible();
    const row = page.locator('.email-record').filter({ hasText: marker });
    await row.locator(':scope > summary').click(); await row.getByText('Read message', { exact: true }).click();
    const pending = page.waitForEvent('download'); await row.getByRole('button', { name: 'Download .eml', exact: true }).click();
    const download = await pending; expect(download.suggestedFilename()).toBe(`${id}.eml`);
    const fs = await import('node:fs/promises'); const bytes = await fs.readFile((await download.path())!);
    expect(bytes.includes(Buffer.from(`Message-ID: <${marker}@example.com>`))).toBe(true);
    expect(bytes.includes(Buffer.from('Content-Disposition: attachment; filename="test.txt"'))).toBe(true);
    await download.delete();
    await expect(row.getByText('Download started. Check your browser downloads.', { exact: true })).toBeVisible();
    await expect(page.locator('a[href*="signature="]')).toHaveCount(0);
  } finally { expect((await fetch(`${base}/emails/receiving/${id}`, { method: 'DELETE', headers })).status).toBe(200); }
});
