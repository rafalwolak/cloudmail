import { test, expect, type Page } from '@playwright/test';

const emailId = '00000000-0000-4000-8000-000000000001';
const email = { id: emailId, subject: 'Receipt <script>untrusted</script>', from: 'billing@example.com', to: ['customer@example.com'], status: 'accepted', last_event: 'delivered', created_at: '2026-10-30T12:00:00Z' };

// Exercise real assets and routing with synthetic administrator responses.
// Authorization itself is covered by the Worker integration tests.
async function workspace(page: Page, options: { historyError?: boolean; anonymous?: boolean; existingWebhook?: boolean; metrics?: 'empty' | 'error'; deliveryEvents?: 'access-required' | 'post-access-required' | 'upstream-error' } = {}) {
  const requests: string[] = [];
  let signedIn = !options.anonymous;
  let webhook = { id: 'hook-1', endpoint: 'https://example.com/events', status: 'enabled', events: ['email.delivered'] };
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    requests.push(url.pathname);
    let body: unknown;
    let status = 200;
    if (url.pathname === '/api/setup') body = { authentication_configured: true, authentication_origin_matches: true, sender_configured: true, administrator_configured: true, registration_enabled: false };
    else if (url.pathname === '/api/auth/sign-in/email') { signedIn = true; body = {}; }
    else if (url.pathname === '/api/auth/sign-out') { signedIn = false; body = {}; }
    else if (url.pathname === '/api/auth/get-session') body = !signedIn ? null : { user: { email: 'admin@example.com', emailVerified: true } };
    else if (url.pathname === '/api/history') {
      status = options.historyError ? 503 : 200;
      body = options.historyError ? { message: 'History is temporarily unavailable. Try again.' } : { data: [{ ...email, id: 'receipt-2', subject: 'Your order is confirmed', to: ['alex@example.com', 'second@example.com'] }, { ...email, id: 'receipt-3', subject: 'Your invoice is ready', last_event: 'deferred', to: ['finance@example.com'] }, email, { ...email, id: 'scheduled-1', subject: 'Service appointment reminder', status: 'scheduled', last_event: null, scheduled_at: '2026-11-01T12:00:00Z' }], has_more: false };
    } else if (url.pathname === `/api/history/${emailId}`) body = { ...email, cc: [], bcc: [], reply_to: null, text: 'Synthetic receipt content', html: null, attachments: [] };
    else if (url.pathname === '/api/history/metrics') {
      if (options.metrics === 'error') { status = 503; body = { message: 'Metrics unavailable. Retry.' }; }
      else {
        const start = url.searchParams.get('start_date') || '2026-10-23T00:00:00Z';
        const end = url.searchParams.get('end_date') || '2026-10-30T00:00:00Z';
        const first = new Date(start); first.setUTCHours(0, 0, 0, 0);
        const empty = options.metrics === 'empty';
        body = { start_date: start, end_date: end, totals: { sent: empty ? 0 : 3, delivered: empty ? 0 : 2, deferred: 0, bounced: 0, failed: 0, rejected: 0, complained: 0 }, data: empty ? [] : [{ period: first.toISOString(), sent: 1, delivered: 2 }, { period: new Date(first.getTime() + 86400000).toISOString(), sent: 2, delivered: 0 }] };
      }
    }
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
      else { status = 502; body = { code: 'cloudflare_queue_access_required', message: 'Cloudflare queue access is missing or expired.' }; }
    } else if (url.pathname === '/api/cloudflare/oauth/start') body = { authorization_url: 'https://dash.cloudflare.com/oauth2/auth?client_id=local-fixture&scope=queues.write' };
    else { status = 500; body = { message: `Unexpected test request: ${url.pathname}` }; }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return requests;
}

async function navigate(page: Page, label: string) {
  await expect(page.locator('#dashboard-view')).toBeVisible();
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


test('metrics show daily activity, switch series without a request and expose exact values', async ({ page }, testInfo) => {
  const requests = await workspace(page);
  await page.goto('/dashboard/metrics');
  await expect(page.locator('#metrics-results')).toContainText('Accepted messages');
  const timeline = page.getByRole('region', { name: 'Activity over time', exact: true });
  await expect(timeline).toBeVisible();
  await expect(page.getByRole('img', { name: 'Accepted messages by UTC day', exact: true })).toBeVisible();
  const initialRequests = requests.filter(path => path === '/api/history/metrics').length;
  await page.getByLabel('Metric', { exact: true }).selectOption('delivered');
  await expect(page.getByRole('img', { name: 'Delivered recipients by UTC day', exact: true })).toBeVisible();
  expect(requests.filter(path => path === '/api/history/metrics')).toHaveLength(initialRequests);
  await page.getByText('View daily data', { exact: true }).click();
  await expect(page.locator('#metrics-daily-rows tr')).toHaveCount(7);
  await expect(page.locator('#metrics-daily-rows tr').first()).toContainText('2');
  await expect(page.getByText('Daily counts need not sum to interval totals.', { exact: false })).toBeVisible();
  await noOverflow(page);
  await capture(page, testInfo.outputPath('metrics.png'));
  await page.getByLabel('Period', { exact: true }).selectOption('90');
  await page.getByRole('button', { name: 'Load overview', exact: true }).click();
  await expect(page.locator('#metrics-daily-rows tr')).toHaveCount(90);
  const dailyValues = page.getByRole('region', { name: 'Daily metric values', exact: true });
  await dailyValues.focus(); await page.keyboard.press('End');
  await expect.poll(() => dailyValues.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await noOverflow(page);
});

test('metrics distinguish no observations from an unavailable report', async ({ page }) => {
  await workspace(page, { metrics: 'empty' });
  await page.goto('/dashboard/metrics');
  await expect(page.locator('#metrics-trend-summary')).toHaveText('No accepted messages recorded in this interval.');
  await page.getByText('View daily data', { exact: true }).click();
  await expect(page.locator('#metrics-daily-rows tr')).toHaveCount(7);
  await expect(page.locator('#metrics-daily-rows td:last-child')).toHaveText(Array(7).fill('0'));
  await page.route('**/api/history/metrics?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Metrics unavailable. Retry.' }) }));
  await page.getByRole('button', { name: 'Load overview', exact: true }).click();
  await expect(page.locator('#metrics-status')).toHaveText('Metrics unavailable. Retry.');
  await expect(page.locator('#metrics-trend')).toBeHidden();
  await expect(page.locator('#metrics-results')).toBeEmpty();
  await expect(page.getByRole('button', { name: 'Load overview', exact: true })).toBeEnabled();
});


test('signing out clears loaded metric values and chart data', async ({ page }) => {
  await workspace(page);
  await page.goto('/dashboard/metrics');
  await expect(page.locator('#metrics-trend')).toBeVisible();
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.locator('#metrics-results')).toBeEmpty();
  await expect(page.locator('#metrics-daily-rows')).toBeEmpty();
  await expect(page.locator('#metrics-trend-summary')).toBeEmpty();
  await expect(page.locator('#metrics-dates')).toBeEmpty();
  await expect(page.locator('#metrics-line')).not.toHaveAttribute('points');
});


test('the module-based dashboard signs in and restores a direct metrics URL', async ({ page }) => {
  await workspace(page, { anonymous: true });
  await page.goto('/dashboard/metrics');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  const form = page.locator('#login-form');
  await form.getByLabel('Email address', { exact: true }).fill('admin@example.com');
  await form.getByLabel('Password', { exact: true }).fill('synthetic-password');
  await form.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Metrics', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Accepted messages by UTC day', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard\/metrics$/);
});

async function composeReceipt(page: Page) {
  await page.goto('/dashboard/compose');
  await page.getByLabel('From', { exact: true }).fill('billing@example.com');
  await page.getByLabel('To', { exact: true }).fill('customer@example.com');
  await page.locator('#compose-form').getByLabel('Subject', { exact: true }).fill('Synthetic receipt');
  await page.getByLabel('Plain text', { exact: true }).fill('Thank you for your order.');
  await page.getByText('Tags (optional)', { exact: true }).click();
  await page.getByRole('button', { name: 'Add tag', exact: true }).click();
  await expect(page.getByLabel('Tag name 1', { exact: true })).toBeFocused();
  await page.getByLabel('Tag name 1', { exact: true }).fill('category');
  await page.getByLabel('Tag value 1', { exact: true }).fill('receipt');
}

test('composer retains tags and idempotency key on retry and resets after acceptance', async ({ page }, testInfo) => {
  await workspace(page);
  const payloads: { tags?: { name: string; value: string }[] }[] = [];
  const keys: string[] = [];
  await page.route('**/api/send', async route => {
    payloads.push(route.request().postDataJSON()); keys.push(route.request().headers()['idempotency-key']);
    await route.fulfill({ status: payloads.length === 1 ? 503 : 200, json: payloads.length === 1 ? { message: 'Sending unavailable.' } : { id: emailId } });
  });
  page.on('dialog', dialog => dialog.accept());
  await composeReceipt(page);
  await page.getByRole('button', { name: 'Add tag', exact: true }).click();
  await page.getByLabel('Tag name 2', { exact: true }).fill('order_id');
  await page.getByLabel('Tag value 2', { exact: true }).fill('ORDER-123');
  await noOverflow(page);
  await capture(page, testInfo.outputPath('compose-tags.png'));
  const send = page.locator('#compose-form').getByRole('button', { name: 'Send email', exact: true });
  await send.click();
  await expect(page.locator('#compose-status')).toContainText('Check history before trying again');
  await expect(page.getByLabel('Tag value 2', { exact: true })).toHaveValue('ORDER-123');
  await send.click();
  await expect(page.locator('#compose-status')).toContainText('Accepted by Cloudflare');
  expect(payloads[0].tags).toEqual([{ name: 'category', value: 'receipt' }, { name: 'order_id', value: 'ORDER-123' }]);
  expect(payloads[1]).toEqual(payloads[0]); expect(keys[0]).toBeTruthy(); expect(keys[1]).toBe(keys[0]);
  await expect(page.locator('#compose-tag-list')).toBeEmpty();
  await expect(page.locator('#compose-tag-count')).toHaveText('0 of 100 tags');
});

test('tag validation opens collapsed fields, removal restores focus, and editing creates a new request', async ({ page }) => {
  const requests = await workspace(page);
  const keys: string[] = [];
  const payloads: Record<string, unknown>[] = [];
  await page.route('**/api/send', async route => {
    payloads.push(route.request().postDataJSON());
    keys.push(route.request().headers()['idempotency-key']);
    await route.fulfill({ status: 503, json: { message: 'Sending unavailable.' } });
  });
  page.on('dialog', dialog => dialog.accept());
  await composeReceipt(page);
  await page.getByLabel('Tag value 1', { exact: true }).fill('invalid value');
  await page.getByText('Tags (optional)', { exact: true }).click();
  const send = page.locator('#compose-form').getByRole('button', { name: 'Send email', exact: true });
  await send.click();
  await expect(page.getByLabel('Tag value 1', { exact: true })).toBeFocused();
  expect(keys).toHaveLength(0); expect(requests).not.toContain('/api/send/prepare');
  await page.getByLabel('Tag value 1', { exact: true }).fill('receipt');
  await send.click(); await expect(page.locator('#compose-status')).toContainText('Sending unavailable');
  await page.getByLabel('Tag value 1', { exact: true }).fill('invoice');
  await send.click(); await expect.poll(() => keys.length).toBe(2); expect(keys[1]).not.toBe(keys[0]);
  await page.getByRole('button', { name: 'Add tag', exact: true }).click();
  await page.getByRole('button', { name: 'Remove tag 1', exact: true }).click();
  await expect(page.getByLabel('Tag name 2', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Remove tag 2', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add tag', exact: true })).toBeFocused();
  await expect(page.locator('#compose-tag-count')).toHaveText('0 of 100 tags');
  await send.click(); await expect.poll(() => payloads.length).toBe(3); expect(payloads[2].tags).toBeUndefined();
});

test('published template preparation and scheduling retain tags', async ({ page }) => {
  await workspace(page);
  let prepared: Record<string, unknown> | undefined;
  let sent: Record<string, unknown> | undefined;
  await page.route('**/api/send/prepare', async route => {
    prepared = route.request().postDataJSON();
    await route.fulfill({ json: { from: 'billing@example.com', to: ['customer@example.com'], subject: 'Published receipt', text: 'Published content', tags: prepared!.tags } });
  });
  await page.route('**/api/send', async route => { sent = route.request().postDataJSON(); await route.fulfill({ json: { id: emailId } }); });
  page.on('dialog', dialog => dialog.accept());
  await composeReceipt(page);
  await page.getByLabel('Message content', { exact: true }).selectOption('template');
  await page.getByLabel('Published template ID or alias', { exact: true }).fill('receipt');
  await page.getByLabel('Send later (optional)', { exact: true }).fill(await page.evaluate(() => { const date = new Date(Date.now() + 3600000); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }));
  await page.locator('#compose-form').getByRole('button', { name: 'Send email', exact: true }).click();
  await expect(page.locator('#compose-status')).toContainText('Scheduled for');
  expect(prepared!.tags).toEqual([{ name: 'category', value: 'receipt' }]);
  expect(sent!.tags).toEqual(prepared!.tags); expect(sent!.template).toBeUndefined(); expect(sent!.scheduled_at).toBeTruthy();
});

test('history renders retained tags as text, handles empty tags and keeps unavailable content explicit', async ({ page }) => {
  await workspace(page);
  const unsafeName = '<script>untrusted</script>';
  let empty = false;
  await page.route(`**/api/history/${emailId}`, route => route.fulfill({ json: { ...email, text: null, html: null, tags: empty ? [] : [{ name: unsafeName, value: 'x'.repeat(256) }], attachments: [] } }));
  await page.goto('/dashboard/emails');
  const record = page.locator('.email-record').filter({ hasText: email.subject });
  await record.locator(':scope > summary').click();
  await record.getByText('Message content', { exact: true }).click();
  await expect(record.locator('.message-tags dt')).toHaveText(unsafeName);
  await expect(record.locator('.message-tags dd')).toHaveText('x'.repeat(256));
  await expect(record.locator('script')).toHaveCount(0);
  await expect(record.getByText('Content is unavailable for this message.', { exact: true })).toBeVisible();
  await noOverflow(page);
  empty = true; await page.reload();
  await record.locator(':scope > summary').click(); await record.getByText('Message content', { exact: true }).click();
  await expect(record.getByText('No tags recorded.', { exact: true })).toBeVisible();
});

test('tag row limit prevents a 101st entry and sign-out clears metadata', async ({ page }) => {
  await workspace(page); await composeReceipt(page);
  // Populate through the same event handler without 99 scrolling animations.
  await page.locator('#compose-add-tag').evaluate(button => { for (let index = 1; index < 100; index++) (button as HTMLButtonElement).click(); });
  await expect(page.locator('#compose-tag-list > .compose-tag')).toHaveCount(100);
  await expect(page.locator('#compose-add-tag')).toBeDisabled();
  await expect(page.locator('#compose-tag-count')).toHaveText('100 of 100 tags');
  page.on('dialog', dialog => dialog.accept());
  const menu = page.getByRole('button', { name: 'Menu', exact: true }); if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.locator('#compose-tag-list')).toBeEmpty();
});

const incoming = { id: 'received-1', sender: 'bounce@example.net', recipient: 'support@example.com', from: 'bounce@example.net', to: 'support@example.com', subject: 'Invoice question', created_at: '2026-10-30T12:00:00Z', header_from: { address: 'customer@example.com', name: 'Customer' }, reply_to: [{ address: 'reply@example.com', name: '<script>untrusted</script>' }], message_id: '<current@example.com>', references: '<first@example.com>', cc: [{ address: 'private@example.com' }], bcc: [], text: 'Original private content', html: '<script>untrusted</script>', attachments: [{ id: '0', filename: 'private.txt', size: 10 }] };
async function replyWorkspace(page: Page, patch: Record<string, unknown> = {}) {
  await workspace(page);
  await page.route('**/api/inbox**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/inbox') await route.fulfill({ json: { data: [incoming], has_more: false } });
    else if (path === '/api/inbox/received-1') await route.fulfill({ json: { ...incoming, ...patch } });
    else await route.fallback();
  });
}
async function openReplyAction(page: Page) {
  await navigate(page, 'Inbox');
  await page.locator('.email-record > summary').click();
  await page.getByText('Read message', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reply', exact: true })).toBeVisible();
}

test('inbox reply prepares threading and only sends user-written content after confirmation', async ({ page }, testInfo) => {
  await replyWorkspace(page);
  const payloads: Record<string, unknown>[] = []; const keys: string[] = [];
  await page.route('**/api/send', async route => {
    payloads.push(route.request().postDataJSON()); keys.push(route.request().headers()['idempotency-key']);
    await route.fulfill({ status: payloads.length === 1 ? 503 : 200, json: payloads.length === 1 ? { message: 'Temporary send failure.' } : { id: emailId } });
  });
  await page.goto('/dashboard'); await openReplyAction(page);
  await capture(page, testInfo.outputPath('reply-inbox.png'));
  await page.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/compose$/);
  await expect(page.getByLabel('From', { exact: true })).toBeFocused();
  await expect(page.getByLabel('From', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('To', { exact: true })).toHaveValue('reply@example.com');
  await expect(page.locator('#compose-subject')).toHaveValue('Re: Invoice question');
  for (const id of ['compose-text', 'compose-html', 'compose-cc', 'compose-bcc']) await expect(page.locator(`#${id}`)).toHaveValue('');
  expect(payloads).toHaveLength(0);
  await page.getByText('Reply threading headers', { exact: true }).click();
  await expect(page.locator('#compose-reply-headers')).toContainText('References: <first@example.com> <current@example.com>');
  await page.getByLabel('From', { exact: true }).fill('support@example.com');
  await page.getByLabel('Plain text', { exact: true }).fill('Here is the requested information.');
  await noOverflow(page); await capture(page, testInfo.outputPath('reply-draft.png'));
  page.on('dialog', dialog => dialog.accept());
  const send = page.locator('#compose-form').getByRole('button', { name: 'Send email', exact: true });
  await send.click(); await expect(page.locator('#compose-status')).toContainText('Check history before trying again');
  await expect(page.locator('#compose-reply-context')).toBeVisible();
  await send.click(); await expect(page.locator('#compose-status')).toContainText('Accepted by Cloudflare');
  expect(payloads[0].headers).toEqual({ 'In-Reply-To': '<current@example.com>', References: '<first@example.com> <current@example.com>' });
  expect(payloads[0].text).toBe('Here is the requested information.'); expect(payloads[0].to).toEqual(['reply@example.com']);
  for (const key of ['html', 'cc', 'bcc', 'attachments']) expect(payloads[0][key]).toBeUndefined();
  expect(payloads[1]).toEqual(payloads[0]); expect(keys[0]).toBeTruthy(); expect(keys[1]).toBe(keys[0]);
  await expect(page.locator('#compose-reply-context')).toBeHidden(); await expect(page.locator('#compose-reply-headers')).toBeEmpty();
  await page.route(/\/api\/history\/[^/]+\/events(?:\?|$)/, route => route.fulfill({ json: { data: [], has_more: false } }));
  await navigate(page, 'Sent emails');
  const sentRecord = page.locator('.email-record').filter({ hasText: email.subject });
  await sentRecord.locator(':scope > summary').click(); await sentRecord.getByText('Delivery events', { exact: true }).click();
  await expect(sentRecord.getByText('No delivery events recorded. A Cloudflare event subscription is required.', { exact: true })).toBeVisible();
  await expect(sentRecord.getByRole('button', { name: 'Reply', exact: true })).toHaveCount(0);
});

test('replacing an unsaved draft requires consent and reply headers can be removed', async ({ page }) => {
  await replyWorkspace(page); await composeReceipt(page);
  await openReplyAction(page);
  page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/inbox$/);
  await navigate(page, 'Send email'); await expect(page.locator('#compose-subject')).toHaveValue('Synthetic receipt');
  await expect(page.locator('#compose-tag-list > .compose-tag')).toHaveCount(1);
  await openReplyAction(page); page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(page.locator('#compose-tag-list')).toBeEmpty();
  await page.getByRole('button', { name: 'Remove reply context', exact: true }).click();
  await expect(page.getByLabel('To', { exact: true })).toBeFocused(); await expect(page.locator('#compose-reply-context')).toBeHidden();
  await page.getByLabel('From', { exact: true }).fill('support@example.com'); await page.getByLabel('Plain text', { exact: true }).fill('A new message.');
  let payload: Record<string, unknown> | undefined;
  await page.route('**/api/send', async route => { payload = route.request().postDataJSON(); await route.fulfill({ json: { id: emailId } }); });
  page.once('dialog', dialog => dialog.accept()); await page.locator('#compose-form').getByRole('button', { name: 'Send email', exact: true }).click();
  await expect(page.locator('#compose-status')).toContainText('Accepted by Cloudflare'); expect(payload!.headers).toBeUndefined();
});

test('malformed received reply addresses do not replace an existing draft or send email', async ({ page }) => {
  await replyWorkspace(page, { reply_to: [{ address: 'safe@example.com\r\nBcc: attacker@example.com' }] });
  await composeReceipt(page); await openReplyAction(page);
  await page.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(page.getByText('Cannot prepare the reply address. Choose recipients manually.', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard\/inbox$/);
  await navigate(page, 'Send email'); await expect(page.locator('#compose-subject')).toHaveValue('Synthetic receipt');
  await expect(page.locator('#compose-reply-context')).toBeHidden();
});

test('missing Message-ID uses header From, omits threading, and sign-out clears reply context', async ({ page }) => {
  await replyWorkspace(page, { reply_to: [], message_id: null });
  await page.goto('/dashboard'); await openReplyAction(page); await page.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(page.getByLabel('To', { exact: true })).toHaveValue('customer@example.com');
  await expect(page.locator('#compose-reply-note')).toContainText('Threading is unavailable');
  await page.getByLabel('From', { exact: true }).fill('support@example.com'); await page.getByLabel('Plain text', { exact: true }).fill('My reply.');
  let payload: Record<string, unknown> | undefined;
  await page.route('**/api/send', async route => { payload = route.request().postDataJSON(); await route.fulfill({ status: 503, json: { message: 'Temporary failure.' } }); });
  page.once('dialog', dialog => dialog.accept()); await page.locator('#compose-form').getByRole('button', { name: 'Send email', exact: true }).click();
  await expect(page.locator('#compose-status')).toContainText('Temporary failure'); expect(payload!.headers).toBeUndefined();
  const menu = page.getByRole('button', { name: 'Menu', exact: true }); if (await menu.isVisible()) await menu.click();
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.locator('#compose-reply-context')).toBeHidden(); await expect(page.locator('#compose-reply-headers')).toBeEmpty();
  await expect(page.locator('#compose-to')).toHaveValue('');
});

test('reply threading survives published template preparation and scheduling', async ({ page }) => {
  await replyWorkspace(page); await page.goto('/dashboard'); await openReplyAction(page); await page.getByRole('button', { name: 'Reply', exact: true }).click();
  await page.getByLabel('Message content', { exact: true }).selectOption('template'); await page.getByLabel('Published template ID or alias', { exact: true }).fill('reply');
  await page.getByLabel('Send later (optional)', { exact: true }).fill(await page.evaluate(() => { const date = new Date(Date.now() + 3600000); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }));
  let prepared: Record<string, unknown> | undefined; let sent: Record<string, unknown> | undefined;
  await page.route('**/api/send/prepare', async route => { prepared = route.request().postDataJSON(); await route.fulfill({ json: { from: 'support@example.com', to: ['reply@example.com'], subject: prepared!.subject, text: 'Published reply', headers: prepared!.headers } }); });
  await page.route('**/api/send', async route => { sent = route.request().postDataJSON(); await route.fulfill({ json: { id: emailId } }); });
  page.once('dialog', dialog => dialog.accept()); await page.locator('#compose-form').getByRole('button', { name: 'Send email', exact: true }).click();
  await expect(page.locator('#compose-status')).toContainText('Scheduled for');
  expect(sent!.headers).toEqual(prepared!.headers); expect(sent!.headers).toEqual({ 'In-Reply-To': '<current@example.com>', References: '<first@example.com> <current@example.com>' });
  expect(sent!.scheduled_at).toBeTruthy(); expect(sent!.template).toBeUndefined();
});

test('reply cannot replace a composer while its send is still in flight', async ({ page }) => {
  await replyWorkspace(page); await composeReceipt(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/send', async route => { await pending; await route.fulfill({ json: { id: emailId } }); });
  page.on('dialog', dialog => dialog.accept());
  await page.locator('#compose-form').getByRole('button', { name: 'Send email', exact: true }).click();
  await expect(page.locator('#compose-form button[type=submit]')).toBeDisabled();
  await openReplyAction(page); await page.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(page.getByText('Wait for the current send to finish before preparing a reply.', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard\/inbox$/);
  await expect(page.locator('#compose-subject')).toHaveValue('Synthetic receipt');
  release(); await expect(page.locator('#compose-form button[type=submit]')).toBeEnabled();
  await page.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/compose$/);
  await expect(page.locator('#compose-subject')).toHaveValue('Re: Invoice question');
});

const rawMime = 'From: sender@example.com\r\nMIME-Version: 1.0\r\n\r\nSynthetic original MIME\r\n';
async function originalDownloadWorkspace(page: Page) {
  await replyWorkspace(page);
  let reads = 0;
  await page.route('**/api/inbox/received-1', async route => {
    reads++;
    const url = new URL('/downloads/receiving/received-1/raw', route.request().url());
    url.searchParams.set('signature', reads === 1 ? 'expired-fixture' : 'fresh-fixture');
    url.searchParams.set('expires', reads === 1 ? '1' : String(Math.floor(Date.now() / 1000) + 300));
    await route.fulfill({ json: { ...incoming, raw: { download_url: url.href, expires_at: new Date(reads === 1 ? 1000 : Date.now() + 300000).toISOString() } } });
  });
  await page.goto('/dashboard'); await openReplyAction(page);
  return () => reads;
}

test('inbox downloads fresh original MIME by keyboard without exposing its capability URL', async ({ page }, testInfo) => {
  const reads = await originalDownloadWorkspace(page);
  let requests = 0;
  await page.route('**/downloads/receiving/received-1/raw?**', async route => {
    requests++; expect(new URL(route.request().url()).searchParams.get('signature')).toBe('fresh-fixture');
    expect(route.request().headers().authorization).toBeUndefined(); expect(route.request().headers().referer).toBeUndefined();
    await route.fulfill({ contentType: 'application/octet-stream', body: rawMime });
  });
  const button = page.getByRole('button', { name: 'Download .eml', exact: true });
  await expect(button).toBeVisible(); await page.getByRole('button', { name: 'Reply', exact: true }).focus(); await page.keyboard.press('Tab'); await expect(button).toBeFocused(); await noOverflow(page);
  await capture(page, testInfo.outputPath('inbox-original-ready.png'));
  const pending = page.waitForEvent('download'); await page.keyboard.press('Enter');
  const download = await pending; expect(download.suggestedFilename()).toBe('received-1.eml');
  const fs = await import('node:fs/promises'); const crypto = await import('node:crypto');
  const bytes = await fs.readFile((await download.path())!);
  expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(crypto.createHash('sha256').update(rawMime).digest('hex'));
  await download.delete();
  expect(reads()).toBe(2); expect(requests).toBe(1);
  await expect(page).toHaveURL(/\/dashboard\/inbox$/); await expect(button).toBeEnabled();
  await expect(page.getByText('Download started. Check your browser downloads.', { exact: true })).toBeVisible();
  await expect(page.locator('a[href*="signature="]')).toHaveCount(0);
});

test('original MIME download exposes loading and recoverable failure without losing the message', async ({ page }, testInfo) => {
  const reads = await originalDownloadWorkspace(page);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let calls = 0;
  await page.route('**/downloads/receiving/received-1/raw?**', async route => {
    if (++calls === 1) { await gate; await route.fulfill({ status: 503, json: { message: 'Storage unavailable' } }); }
    else await route.fulfill({ contentType: 'application/octet-stream', body: rawMime });
  });
  await page.getByRole('button', { name: 'Download .eml', exact: true }).click();
  const loading = page.getByRole('button', { name: 'Downloading…', exact: true });
  await expect(loading).toBeDisabled(); await noOverflow(page); await capture(page, testInfo.outputPath('inbox-original-loading.png'));
  release();
  const retry = page.getByRole('button', { name: 'Download .eml', exact: true });
  await expect(page.getByText('Could not download original message. Try again.', { exact: true })).toBeVisible(); await expect(retry).toBeEnabled();
  await expect(page.getByText(incoming.text, { exact: true })).toBeVisible(); await noOverflow(page);
  await capture(page, testInfo.outputPath('inbox-original-error.png'));
  const pending = page.waitForEvent('download'); await retry.click(); const download = await pending; await download.delete();
  expect(reads()).toBe(3); expect(calls).toBe(2);
});

test('original MIME download handles missing configuration and refuses foreign URLs', async ({ page }) => {
  await originalDownloadWorkspace(page); let raw: unknown = null; let foreignRequests = 0;
  await page.route('**/api/inbox/received-1', route => route.fulfill({ json: { ...incoming, raw } }));
  await page.route('https://other.example.net/**', async route => { foreignRequests++; await route.abort(); });
  const button = page.getByRole('button', { name: 'Download .eml', exact: true });
  await button.click();
  await expect(page.getByText('Original download is unavailable for this installation.', { exact: true })).toBeVisible(); await expect(button).toBeEnabled();
  raw = { download_url: 'https://other.example.net/download', expires_at: new Date(Date.now() + 300000).toISOString() };
  await button.click();
  await expect(page.getByText('Could not download original message. Try again.', { exact: true })).toBeVisible(); await expect(button).toBeEnabled();
  expect(foreignRequests).toBe(0); await expect(page.getByText(incoming.text, { exact: true })).toBeVisible();
});

for (const destination of ['navigation', 'sign-out']) test(`leaving the inbox by ${destination} cancels a pending original download`, async ({ page }) => {
  await originalDownloadWorkspace(page);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void; const requested = new Promise<void>(resolve => { started = resolve; }); let downloads = 0;
  page.on('download', () => { downloads++; });
  await page.route('**/downloads/receiving/received-1/raw?**', async route => { started(); await gate; await route.fulfill({ contentType: 'application/octet-stream', body: rawMime }).catch(() => {}); });
  await page.getByRole('button', { name: 'Download .eml', exact: true }).click(); await requested;
  const canceled = page.waitForEvent('requestfailed', request => new URL(request.url()).pathname.startsWith('/downloads/receiving/'));
  if (destination === 'navigation') await navigate(page, 'Sent emails');
  else {
    const menu = page.getByRole('button', { name: 'Menu', exact: true }); if (await menu.isVisible()) await menu.click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  }
  await canceled; release();
  if (destination === 'navigation') await expect(page.getByRole('heading', { name: 'Sent emails', exact: true })).toBeVisible();
  else await expect(page.locator('#login-view')).toBeVisible();
  expect(downloads).toBe(0);
});

test('a failed inbox refresh leaves canceled original downloads with an accurate status', async ({ page }) => {
  await originalDownloadWorkspace(page);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void; const requested = new Promise<void>(resolve => { started = resolve; });
  await page.route('**/downloads/receiving/received-1/raw?**', async route => { started(); await gate; await route.fulfill({ contentType: 'application/octet-stream', body: rawMime }).catch(() => {}); });
  await page.getByRole('button', { name: 'Download .eml', exact: true }).click(); await requested;
  await page.route('**/api/inbox?**', route => route.fulfill({ status: 503, json: { message: 'Inbox unavailable. Retry.' } }));
  const canceled = page.waitForEvent('requestfailed', request => new URL(request.url()).pathname.startsWith('/downloads/receiving/'));
  const filters = page.locator('#inbox-filter').locator('..');
  await filters.locator('summary').click();
  await page.locator('#inbox-clear').click(); await canceled; release();
  await expect(page.locator('#inbox-status')).toContainText('Inbox unavailable. Retry.');
  await expect(page.getByText('Download canceled.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download .eml', exact: true })).toBeEnabled();
  await expect(page.getByText('Downloading original message…', { exact: true })).toHaveCount(0);
});

test('responsive navigation waits for delayed session bootstrap before checking the menu', async ({ page }) => {
  await workspace(page);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void; const requested = new Promise<void>(resolve => { started = resolve; });
  await page.route('**/api/auth/get-session', async route => {
    started(); await gate;
    await route.fulfill({ json: { user: { email: 'admin@example.com', emailVerified: true } } });
  });
  await page.goto('/dashboard'); await requested;
  const navigating = navigate(page, 'Inbox');
  await expect(page.locator('#dashboard-view')).toBeHidden();
  // Observe the pre-bootstrap menu before releasing the session, matching the CI race.
  expect(await page.getByRole('button', { name: 'Menu', exact: true }).isVisible()).toBe(false);
  release(); await navigating;
  await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible();
});
