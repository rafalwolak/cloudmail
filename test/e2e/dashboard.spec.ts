import { test, expect, type Page } from '@playwright/test';

const emailId = '00000000-0000-4000-8000-000000000001';
const email = { id: emailId, subject: 'Receipt <script>untrusted</script>', from: 'billing@example.com', to: ['customer@example.com'], status: 'accepted', last_event: 'delivered', created_at: '2026-10-30T12:00:00Z' };

// Exercise real assets and routing with synthetic administrator responses.
// Authorization itself is covered by the Worker integration tests.
async function workspace(page: Page, options: { historyError?: boolean; anonymous?: boolean; existingWebhook?: boolean; deliveryEvents?: 'access-required' | 'post-access-required' | 'upstream-error' } = {}) {
  const requests: string[] = [];
  let webhook = { id: 'hook-1', endpoint: 'https://example.com/events', status: 'enabled', events: ['email.delivered'] };
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    requests.push(url.pathname);
    let body: unknown;
    let status = 200;
    if (url.pathname === '/api/setup') body = { authentication_configured: true, authentication_origin_matches: true, sender_configured: true, administrator_configured: true, registration_enabled: false };
    else if (url.pathname === '/api/auth/get-session') body = options.anonymous ? null : { user: { email: 'admin@example.com', emailVerified: true } };
    else if (url.pathname === '/api/history') {
      status = options.historyError ? 503 : 200;
      body = options.historyError ? { message: 'History is temporarily unavailable. Try again.' } : { data: [{ ...email, id: 'receipt-2', subject: 'Your order is confirmed', to: ['alex@example.com', 'second@example.com'] }, { ...email, id: 'receipt-3', subject: 'Your invoice is ready', last_event: 'deferred', to: ['finance@example.com'] }, email, { ...email, id: 'scheduled-1', subject: 'Service appointment reminder', status: 'scheduled', last_event: null, scheduled_at: '2026-11-01T12:00:00Z' }], has_more: false };
    } else if (url.pathname === `/api/history/${emailId}`) body = { ...email, cc: [], bcc: [], reply_to: null, text: 'Synthetic receipt content', html: null, attachments: [] };
    else if (url.pathname === '/api/history/metrics') body = { start_date: '2026-10-23T00:00:00Z', end_date: '2026-10-30T00:00:00Z', totals: { sent: 1, delivered: 1, deferred: 0, bounced: 0, failed: 0, rejected: 0, complained: 0 } };
    else if (url.pathname === '/api/keys') body = { data: [], has_more: false };
    else if (url.pathname === '/api/templates') body = { data: [], has_more: false };
    else if (url.pathname === '/api/webhooks') body = { data: options.existingWebhook ? [webhook] : [], has_more: false };
    else if (url.pathname === '/api/webhooks/hook-1' && route.request().method() === 'PATCH') { webhook = { ...webhook, ...route.request().postDataJSON() }; body = { id: webhook.id }; }
    else if (url.pathname === '/api/inbox') body = { data: [], has_more: false };
    else if (url.pathname === '/api/cloudflare/oauth/status') body = { connected: Boolean(options.deliveryEvents), configured: true };
    else if (url.pathname === '/api/cloudflare/zones') body = { data: options.deliveryEvents ? [{ id: 'a'.repeat(32), name: 'example.com', account_id: 'b'.repeat(32) }] : [] };
    else if (url.pathname === `/api/cloudflare/zones/${'a'.repeat(32)}/domains`) body = { data: [{ tag: 'c'.repeat(32), name: 'mail.example.com', enabled: true }] };
    else if (url.pathname.endsWith('/delivery-events')) {
      if (options.deliveryEvents === 'upstream-error') { status = 502; body = { message: 'Delivery events could not be checked. Try again.' }; }
      else if (options.deliveryEvents === 'post-access-required' && route.request().method() === 'GET') body = { action: 'missing' };
      else { status = 403; body = { code: 'cloudflare_queue_access_required', message: 'Cloudflare queue access is missing or expired.' }; }
    } else if (url.pathname === '/api/cloudflare/oauth/start') body = { authorization_url: 'https://dash.cloudflare.com/oauth2/auth?client_id=local-fixture&scope=queues.write' };
    else { status = 500; body = { message: `Unexpected test request: ${url.pathname}` }; }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return requests;
}

async function navigate(page: Page, label: string) {
  const toggle = page.getByRole('button', { name: 'Menu', exact: true });
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole('navigation', { name: 'Dashboard navigation' }).getByRole('link', { name: label, exact: true }).click();
}

async function capture(page: Page, path: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator('.sidebar-top')).toBeInViewport();
  await page.screenshot({ path, fullPage: true, animations: 'disabled' });
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('direct email URL shows compact records and loads details on demand', async ({ page }, testInfo) => {
  const requests = await workspace(page);
  await page.goto('/dashboard/emails');
  await expect(page.getByRole('heading', { name: 'Sent emails', exact: true })).toBeVisible();
  await expect(page.locator('.email-record')).toHaveCount(4);
  await expect(page.getByText('Synthetic receipt content')).toBeHidden();
  expect(requests).not.toContain(`/api/history/${emailId}`);
  expect(requests).not.toContain('/api/keys');
  const summary = page.locator('.email-record > summary').filter({ hasText: email.subject });
  await expect(summary).toContainText(email.subject);
  await expect(summary).toContainText('Delivered');
  await summary.focus();
  await page.keyboard.press('Enter');
  await page.locator('.email-record').filter({ hasText: email.subject }).getByText('Message content', { exact: true }).click();
  await expect(page.getByText('Synthetic receipt content')).toBeVisible();
  await expect(page.locator('script:not([src])')).toHaveCount(0);
  await noOverflow(page);
  const content = await page.locator('.page-content').boundingBox();
  if (testInfo.project.name === 'desktop') expect(content!.width).toBeGreaterThan(1100);
  await summary.click();
  await capture(page, testInfo.outputPath('emails.png'));
});

test('function navigation preserves URLs, active state and browser history', async ({ page }, testInfo) => {
  await workspace(page);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await navigate(page, 'Templates');
  await expect(page).toHaveURL(/\/dashboard\/templates$/);
  await expect(page.getByRole('heading', { name: 'Templates', exact: true })).toBeFocused();
  await expect(page.getByText('No templates yet.', { exact: true })).toBeVisible();
  await navigate(page, 'API keys');
  await expect(page).toHaveURL(/\/dashboard\/api-keys$/);
  await expect(page.locator('#key-form')).toBeHidden();
  await page.getByText('Create API key', { exact: true }).click();
  await expect(page.getByLabel('Key name', { exact: true })).toBeVisible();
  await noOverflow(page);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Templates', exact: true })).toBeVisible();
  await expect(page.locator('[data-page=templates][aria-current=page]')).toHaveCount(1);
  if (testInfo.project.name !== 'desktop') {
    await expect(page.getByRole('navigation', { name: 'Dashboard navigation' })).toBeHidden();
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Menu', exact: true })).toHaveAttribute('aria-expanded', 'false');
  }
});

test('all function pages fit the viewport and restore correctly on reload', async ({ page }, testInfo) => {
  await workspace(page);
  const pages = [['', 'Overview'], ['emails', 'Sent emails'], ['inbox', 'Inbox'], ['compose', 'Send email'], ['templates', 'Templates'], ['domains', 'Domains'], ['metrics', 'Metrics'], ['api-keys', 'API keys'], ['webhooks', 'Webhooks']];
  for (const [route, heading] of pages) {
    await page.goto(`/dashboard${route ? `/${route}` : ''}`);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.locator('[data-dashboard-page]:visible')).toHaveCount(1);
    await noOverflow(page);
  }
  await page.getByText('Add webhook', { exact: true }).click();
  await expect(page.getByLabel('Endpoint URL')).toBeVisible();
  await noOverflow(page);
  await capture(page, testInfo.outputPath('webhooks.png'));
  await page.goto('/dashboard/compose');
  await page.getByLabel('From', { exact: true }).fill('billing@example.com');
  await page.getByLabel('To', { exact: true }).fill('customer@example.com');
  await page.locator('#compose-form').getByLabel('Subject', { exact: true }).fill('A synthetic receipt');
  await page.getByLabel('Plain text', { exact: true }).fill('Local preview only.');
  await capture(page, testInfo.outputPath('compose.png'));
});

test('request failure stays on its page and does not block other functions', async ({ page }) => {
  await workspace(page, { historyError: true });
  await page.goto('/dashboard/emails');
  await expect(page.locator('#history-status')).toHaveText('History is temporarily unavailable. Try again.');
  await navigate(page, 'Inbox');
  await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible();
  await expect(page.locator('#empty-inbox')).toBeVisible();
});

test('anonymous deep links keep administrator data and navigation hidden', async ({ page }) => {
  const requests = await workspace(page, { anonymous: true });
  await page.goto('/dashboard/emails');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Dashboard navigation' })).toBeHidden();
  expect(requests).not.toContain('/api/history');
  await noOverflow(page);
});


test('scheduled controls and filter labels remain usable inside their records', async ({ page }) => {
  await workspace(page);
  await page.goto('/dashboard/emails');
  await page.getByText('Filter sent email', { exact: true }).click();
  for (const id of ['history-from', 'history-to', 'history-recipient', 'history-subject', 'history-state', 'history-event']) {
    const field = page.locator(`#${id}`);
    await expect(field).toBeVisible();
    expect(await field.evaluate(element => element.parentElement?.querySelector('label')?.htmlFor)).toBe(id);
  }
  const scheduled = page.locator('.email-record').filter({ hasText: 'Service appointment reminder' });
  await scheduled.locator(':scope > summary').click();
  await expect(scheduled.getByRole('button', { name: 'Reschedule', exact: true })).toBeVisible();
  await expect(scheduled.getByRole('button', { name: 'Cancel scheduled email Service appointment reminder', exact: true })).toBeVisible();
  await noOverflow(page);
});


test('webhook editing opens the editor, focuses its endpoint and saves changes', async ({ page }, testInfo) => {
  await workspace(page, { existingWebhook: true });
  await page.goto('/dashboard/webhooks');
  await expect(page.locator('#webhook-form')).toBeHidden();
  await page.getByRole('button', { name: 'Edit webhook https://example.com/events', exact: true }).click();
  const endpoint = page.getByLabel('Endpoint URL');
  await expect(endpoint).toBeVisible();
  await expect(endpoint).toBeFocused();
  await endpoint.fill('https://example.com/updated-events');
  const saved = page.waitForRequest(request => request.method() === 'PATCH' && new URL(request.url()).pathname === '/api/webhooks/hook-1');
  await page.getByRole('button', { name: 'Save webhook', exact: true }).click();
  expect((await saved).postDataJSON()).toEqual({ endpoint: 'https://example.com/updated-events', events: ['email.delivered'] });
  await expect(page.locator('#webhook-status')).toHaveText('Webhook updated.');
  await expect(page.locator('#webhook-list')).toContainText('https://example.com/updated-events');
  await noOverflow(page);
  await capture(page, testInfo.outputPath('webhook-edit.png'));
});

test('multiple recipients keep the attempt status separate from the latest recipient event', async ({ page }) => {
  await workspace(page);
  await page.goto('/dashboard/emails');
  const summary = page.locator('.email-record > summary').filter({ hasText: 'Your order is confirmed' });
  await expect(summary).toContainText('alex@example.com, second@example.com');
  await expect(summary).toContainText('Accepted by Cloudflare');
  await expect(summary).toContainText('Latest recipient event: Delivered');
});


async function openDeliveryCheck(page: Page) {
  await page.goto('/dashboard/domains');
  await page.getByRole('button', { name: 'Load sending domains', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Load sending domains', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Check delivery events for mail.example.com', exact: true }).click();
}

test('delivery queue denial offers explicit reconnection without automatically starting OAuth', async ({ page }, testInfo) => {
  const requests = await workspace(page, { deliveryEvents: 'access-required' });
  await page.route('https://dash.cloudflare.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Cloudflare authorization fixture</h1>' }));
  await openDeliveryCheck(page);
  const reconnect = page.getByRole('button', { name: 'Reconnect Cloudflare for mail.example.com', exact: true });
  await expect(reconnect).toBeVisible();
  await expect(page.getByText('After reconnecting, choose your zones again.', { exact: false })).toBeVisible();
  expect(requests).not.toContain('/api/cloudflare/oauth/start');
  await noOverflow(page);
  await capture(page, testInfo.outputPath('queue-access.png'));
  await reconnect.click();
  await expect(page.getByRole('heading', { name: 'Cloudflare authorization fixture', exact: true })).toBeVisible();
  expect(requests.filter(path => path === '/api/cloudflare/oauth/start')).toHaveLength(1);
});

test('unrelated delivery event failure does not suggest changing authorization', async ({ page }) => {
  await workspace(page, { deliveryEvents: 'upstream-error' });
  await openDeliveryCheck(page);
  await expect(page.getByText('Delivery events could not be checked. Try again.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reconnect Cloudflare for mail.example.com', exact: true })).toBeHidden();
});

test('delivery subscription creation denial replaces the connect action with reconnection', async ({ page }) => {
  await workspace(page, { deliveryEvents: 'post-access-required' });
  await openDeliveryCheck(page);
  const connect = page.getByRole('button', { name: 'Connect delivery events', exact: true });
  await expect(connect).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await connect.click();
  await expect(page.getByRole('button', { name: 'Reconnect Cloudflare for mail.example.com', exact: true })).toBeVisible();
  await expect(connect).toBeHidden();
});

test('a successful permission recheck clears the recovery action without claiming delivery', async ({ page }) => {
  await workspace(page, { deliveryEvents: 'access-required' });
  await openDeliveryCheck(page);
  const reconnect = page.getByRole('button', { name: 'Reconnect Cloudflare for mail.example.com', exact: true });
  await expect(reconnect).toBeVisible();
  await page.route('**/delivery-events', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ action: 'ready', id: 'fixture' }) }));
  await page.getByRole('button', { name: 'Check delivery events for mail.example.com', exact: true }).click();
  await expect(reconnect).toBeHidden();
  await expect(page.getByText('Delivery event subscription connected. Event arrival is not yet verified.', { exact: true })).toBeVisible();
});


test('a failed OAuth start leaves the recovery action retryable', async ({ page }) => {
  await workspace(page, { deliveryEvents: 'access-required' });
  let attempts = 0;
  await page.route('**/api/cloudflare/oauth/start', async route => {
    attempts++;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Cloudflare authorization could not be started' }) });
  });
  await openDeliveryCheck(page);
  const reconnect = page.getByRole('button', { name: 'Reconnect Cloudflare for mail.example.com', exact: true });
  await expect(reconnect).toBeVisible();
  await reconnect.click();
  await expect(page.locator('#cloudflare-status')).toHaveText('Cloudflare authorization could not be started');
  await expect(page.getByRole('button', { name: 'Connect Cloudflare', exact: true })).toBeEnabled();
  await reconnect.click();
  await expect.poll(() => attempts).toBe(2);
});


test('zone discovery can retry a failure and continue through multiple pages', async ({ page }) => {
  await workspace(page, { deliveryEvents: 'access-required' });
  let calls = 0;
  await page.route('**/api/cloudflare/zones/available?*', async route => {
    calls++;
    if (calls === 1) {
      await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ message: 'Zone discovery unavailable. Retry.' }) });
      return;
    }
    const number = Number(new URL(route.request().url()).searchParams.get('page'));
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [{ id: String(number).repeat(32), name: `zone${number}.example.com`, account: { name: 'Synthetic account' }, status: 'active' }], totalPages: 3 }) });
  });
  await page.goto('/dashboard/domains');
  const choose = page.getByRole('button', { name: 'Choose zones', exact: true });
  await choose.click();
  await expect(page.locator('#cloudflare-status')).toHaveText('Zone discovery unavailable. Retry.');
  await expect(choose).toBeEnabled();
  await choose.click();
  await expect(page.getByLabel('Available zones', { exact: true })).toBeVisible();
  const more = page.getByRole('button', { name: 'Load more zones', exact: true });
  await more.click();
  await expect(page.locator('#cloudflare-zone option')).toHaveCount(2);
  await expect(more).toBeEnabled();
  await more.click();
  await expect(page.locator('#cloudflare-zone option')).toHaveCount(3);
  await expect(more).toBeHidden();
});
