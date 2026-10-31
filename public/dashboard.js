import { replyDraft } from '/dashboard-reply.js';
import { metricLabels, dailyMetricRows, metricPlot } from '/dashboard-metrics.js';

const $ = (selector) => document.querySelector(selector);
const status = $('#status');
const announce = (message) => { status.textContent = message; };
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...options.headers } });
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const error = new Error(body?.message || 'Request failed. Please try again.');
    if (typeof body?.code === 'string') error.code = body.code;
    throw error;
  }
  return body;
}
const views = ['login', 'signup', 'verify', 'forgot', 'reset', 'dashboard'];
function showView(view) {
  for (const name of views) $(`#${name}-view`).hidden = name !== view;
}
let resetToken = new URLSearchParams(location.search).get('token');
const resetError = new URLSearchParams(location.search).get('error');
const cloudflareResult = new URLSearchParams(location.search).get('cloudflare');
const cloudflareConnected = cloudflareResult === 'connected';
if (resetToken || resetError || ['connected', 'denied'].includes(cloudflareResult)) history.replaceState(null, '', cloudflareResult ? '/dashboard/domains' : location.pathname);
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { showView(button.dataset.view); announce(''); }));
const navigationToggle = $('#navigation-toggle');
function closeNavigation() {
  $('#dashboard-sidebar').classList.remove('navigation-open');
  navigationToggle.setAttribute('aria-expanded', 'false');
}
navigationToggle.addEventListener('click', () => {
  const open = navigationToggle.getAttribute('aria-expanded') !== 'true';
  $('#dashboard-sidebar').classList.toggle('navigation-open', open);
  navigationToggle.setAttribute('aria-expanded', String(open));
});
$('#dashboard-sidebar').addEventListener('keydown', event => {
  if (event.key === 'Escape' && navigationToggle.getAttribute('aria-expanded') === 'true') { closeNavigation(); navigationToggle.focus(); }
});
const dashboardPages = new Set(['overview', 'emails', 'inbox', 'compose', 'templates', 'domains', 'metrics', 'api-keys', 'webhooks']);
function showDashboardPage(page, focus = false) {
  if (!dashboardPages.has(page)) page = 'overview';
  if (page !== 'inbox') cancelInboxDownloads();
  document.querySelectorAll('[data-dashboard-page]').forEach(section => { section.hidden = section.dataset.dashboardPage !== page; });
  document.querySelectorAll('.dashboard-sidebar [data-page]').forEach(link => {
    if (link.dataset.page === page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  const names = { overview: 'Overview', emails: 'Sent emails', inbox: 'Inbox', compose: 'Send email', templates: 'Templates', domains: 'Domains', metrics: 'Metrics', 'api-keys': 'API keys', webhooks: 'Webhooks' };
  closeNavigation();
  $('#page-name').textContent = names[page];
  document.title = `${names[page]} - Cloudmail`;
  announce('');
  if (document.body.classList.contains('signed-in')) void loadDashboardPage(page);
  if (focus) { const heading = document.querySelector(`[data-dashboard-page="${page}"] h1, [data-dashboard-page="${page}"] h2, [data-dashboard-page="${page}"] h3`); heading?.setAttribute('tabindex', '-1'); heading?.focus(); }
}
function pageFromLocation() { return location.pathname.slice('/dashboard'.length).replace(/^\/|\/$/g, '') || 'overview'; }
document.querySelectorAll('[data-page]').forEach(link => link.addEventListener('click', event => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault(); history.pushState(null, '', link.getAttribute('href')); showDashboardPage(link.dataset.page, true);
}));
window.addEventListener('popstate', () => showDashboardPage(pageFromLocation(), true));

async function loadDashboardPage(page) {
  // Load only the visible function so a failed integration cannot block other pages.
  try {
    if (page === 'emails') await loadHistory(true);
    else if (page === 'inbox') await loadInbox(true);
    else if (page === 'templates') await loadTemplates();
    else if (page === 'api-keys') await loadKeys();
    else if (page === 'webhooks') await loadWebhooks();
    else if (page === 'metrics') $('#metrics-form').requestSubmit();
    else if (page === 'domains') { await loadCloudflareStatus(); await loadSelectedCloudflareZones(); }
  } catch (error) {
    const messages = { emails: '#history-status', inbox: '#inbox-status', templates: '#template-status', webhooks: '#webhook-status', domains: '#cloudflare-status' };
    if (messages[page]) $(messages[page]).textContent = error.message;
    else announce(error.message);
  }
}
let cloudflareGeneration = 0;
function setSignedIn(session) {
  metricsGeneration++; cloudflareGeneration++;
  showView(session ? 'dashboard' : 'login');
  document.body.classList.toggle('signed-in', Boolean(session));
  if (session) showDashboardPage(pageFromLocation());
  $('#new-key').hidden = true;
  $('#key-value').textContent = '';
  if (session) { $('#account').textContent = session.user.email; if (cloudflareConnected) $('#cloudflare-status').textContent = 'Cloudflare connected. Choose zones to manage sending domains.'; }
  else { $('#cloudflare-selected-zones').replaceChildren(); $('#cloudflare-zone').replaceChildren(); $('#cloudflare-selected-zone').replaceChildren(); $('#cloudflare-domain-list').replaceChildren(); $('#cloudflare-suppression-list').replaceChildren(); $('#cloudflare-more-suppressions').hidden = true; suppressionCursor = null; $('#cloudflare-domain-controls').hidden = true; $('#cloudflare-disconnect').hidden = true; $('#cloudflare-domain-form').reset(); $('#cloudflare-suppression-form').reset(); $('#suppression-domain-wrap').hidden = true; $('#suppression-domain').required = false; $('#cloudflare-zone-form').hidden = true; $('#cloudflare-no-zones').hidden = false; $('#cloudflare-status').textContent = ''; $('#compose-form').reset(); resetComposeReply(); resetComposeTags(); resetComposeTemplatePicker(); updateComposeMode(); $('#compose-status').textContent = ''; composeKey = null; composeDirty = false; $('#metrics-results').replaceChildren(); $('#metrics-status').textContent = ''; clearMetricsReport(); resetWebhookForm(); $('#webhook-list').replaceChildren(); $('#webhook-secret-value').textContent = ''; $('#webhook-secret').hidden = true; $('#webhook-status').textContent = ''; $('#inbox-list').replaceChildren(); $('#inbox-more').hidden = true; $('#inbox-status').textContent = ''; inboxCursor = null; $('#history-list').replaceChildren(); $('#history-status').textContent = ''; $('#load-more').hidden = true; $('#template-list').replaceChildren(); $('#more-templates').hidden = true; templateCursor = null; templateGeneration++; templateFilters = {}; $('#template-filter').reset(); $('#template-form').reset(); $('#template-form').hidden = true; $('#template-preview').hidden = true; $('#template-preview-content').replaceChildren(); templateId = null; templateDirty = false; }
  if (!session) { cancelInboxDownloads(); inboxGeneration++; inboxFilters = {}; $('#inbox-filter').reset(); historyGeneration++; historyFilters = {}; $('#history-filter').reset(); }
}
let cloudflarePage = 1;
async function loadCloudflareStatus() {
  const result = await api('/api/cloudflare/oauth/status');
  $('#cloudflare-disconnect').hidden = !result.connected;
  if (cloudflareResult === 'denied') $('#cloudflare-status').textContent = 'Cloudflare authorization was not completed. You can try again.';
  else if (result.connected) $('#cloudflare-status').textContent = 'Cloudflare connection saved. Choose zones to check access and manage sending domains.';
  else $('#cloudflare-status').textContent = result.configured ? 'Cloudflare is not connected yet.' : 'Cloudflare connection is not available for this installation yet.';
}
async function loadSelectedCloudflareZones() {
  const { data } = await api('/api/cloudflare/zones');
  const list = $('#cloudflare-selected-zones'); list.replaceChildren();
  const select = $('#cloudflare-selected-zone'); const selected = select.value; select.replaceChildren();
  for (const zone of data) { const item = document.createElement('li'); item.textContent = zone.name; list.append(item); const option = document.createElement('option'); option.value = zone.id; option.textContent = zone.name; select.append(option); }
  if (data.some(zone => zone.id === selected)) select.value = selected;
  $('#cloudflare-no-zones').hidden = data.length > 0; $('#cloudflare-domain-controls').hidden = data.length === 0;
}
async function loadAvailableCloudflareZones(page) {
  const result = await api(`/api/cloudflare/zones/available?page=${page}`);
  const select = $('#cloudflare-zone');
  if (page === 1) select.replaceChildren();
  for (const zone of result.data) { const option = document.createElement('option'); option.value = zone.id; option.textContent = `${zone.name} · ${zone.account.name} · ${zone.status}`; select.append(option); }
  cloudflarePage = page; $('#cloudflare-next-page').hidden = page >= result.totalPages;
  $('#cloudflare-zone-form').hidden = select.options.length === 0;
  $('#cloudflare-status').textContent = select.options.length ? 'Select a zone to manage its sending domains.' : 'No accessible zones found.';
}
$('#cloudflare-connect').addEventListener('click', async event => {
  const button = event.currentTarget; button.disabled = true; $('#cloudflare-status').textContent = 'Opening Cloudflare authorization…';
  try {
    const { authorization_url } = await api('/api/cloudflare/oauth/start', { method: 'POST', body: '{}' });
    const url = new URL(authorization_url);
    if (url.origin !== 'https://dash.cloudflare.com' || url.pathname !== '/oauth2/auth') throw new Error('Invalid Cloudflare authorization URL.');
    location.assign(url.toString());
  } catch (error) { $('#cloudflare-status').textContent = error.message; button.disabled = false; }
});
$('#cloudflare-disconnect').addEventListener('click', async event => {
  if (!window.confirm('Disconnect Cloudflare? Cloudmail will revoke its access and forget selected zones. Sending configuration in Cloudflare remains unchanged.')) return;
  event.currentTarget.disabled = true; $('#cloudflare-status').textContent = 'Disconnecting Cloudflare…';
  try {
    await api('/api/cloudflare/oauth/disconnect', { method: 'POST', body: '{}' });
    cloudflareGeneration++; $('#cloudflare-zone-form').hidden = true; $('#cloudflare-domain-list').replaceChildren(); $('#cloudflare-suppression-list').replaceChildren(); $('#cloudflare-more-suppressions').hidden = true; suppressionCursor = null;
    await loadSelectedCloudflareZones(); await loadCloudflareStatus(); $('#cloudflare-status').textContent = 'Cloudflare disconnected.';
  } catch (error) { $('#cloudflare-status').textContent = error.message; }
  finally { event.currentTarget.disabled = false; }
});
$('#cloudflare-load-zones').addEventListener('click', async event => {
  const button = event.currentTarget; button.disabled = true; $('#cloudflare-status').textContent = 'Loading zones…';
  try { await loadAvailableCloudflareZones(1); } catch (error) { $('#cloudflare-status').textContent = error.message; }
  finally { button.disabled = false; }
});
$('#cloudflare-next-page').addEventListener('click', async event => {
  const button = event.currentTarget; button.disabled = true;
  try { await loadAvailableCloudflareZones(cloudflarePage + 1); } catch (error) { $('#cloudflare-status').textContent = error.message; }
  finally { button.disabled = false; }
});
$('#cloudflare-zone-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.currentTarget.querySelector('button[type="submit"]'); button.disabled = true;
  try { await api('/api/cloudflare/zones', { method: 'POST', body: JSON.stringify({ zone_id: $('#cloudflare-zone').value }) }); await loadSelectedCloudflareZones(); $('#cloudflare-status').textContent = 'Zone added.'; }
  catch (error) { $('#cloudflare-status').textContent = error.message; } finally { button.disabled = false; }
});
async function loadCloudflareDomains() {
  const zone = $('#cloudflare-selected-zone').value; const generation = cloudflareGeneration;
  const result = await api(`/api/cloudflare/zones/${encodeURIComponent(zone)}/domains`);
  if (generation !== cloudflareGeneration || zone !== $('#cloudflare-selected-zone').value) return null;
  const list = $('#cloudflare-domain-list'); list.replaceChildren();
  if (!Array.isArray(result.data)) throw new Error('Unexpected Cloudflare domain response.');
  if (!result.data.length) { const item = document.createElement('li'); item.textContent = 'No sending domains configured in this zone.'; list.append(item); }
  for (const domain of result.data) {
    const item = document.createElement('li'); item.className = 'domain-record'; const label = document.createElement('span');
    label.textContent = `${domain.name} · ${domain.enabled ? 'Enabled' : 'Not enabled'} (DNS and delivery not verified)`; item.append(label);
    if (domain.enabled) {
      const checkEvents = document.createElement('button'); checkEvents.type = 'button'; checkEvents.className = 'text-button'; checkEvents.textContent = 'Check delivery events'; checkEvents.setAttribute('aria-label', `Check delivery events for ${domain.name}`);
      const connectEvents = document.createElement('button'); connectEvents.type = 'button'; connectEvents.className = 'text-button'; connectEvents.textContent = 'Connect delivery events'; connectEvents.hidden = true;
      const reconnect = document.createElement('button'); reconnect.type = 'button'; reconnect.className = 'secondary'; reconnect.textContent = 'Reconnect Cloudflare'; reconnect.hidden = true;
      reconnect.setAttribute('aria-label', `Reconnect Cloudflare for ${domain.name}`);
      reconnect.addEventListener('click', () => $('#cloudflare-connect').click());
      const accessHelp = document.createElement('p'); accessHelp.hidden = true; accessHelp.textContent = 'Review the requested permissions on Cloudflare. After reconnecting, choose your zones again.';
      const eventStatus = document.createElement('p'); eventStatus.setAttribute('role', 'status');
      const check = async method => {
        checkEvents.disabled = true; connectEvents.disabled = true; reconnect.hidden = true; accessHelp.hidden = true;
        try {
          const report = await api(`/api/cloudflare/zones/${encodeURIComponent(zone)}/domains/${encodeURIComponent(domain.tag)}/delivery-events`, { method });
          if (generation !== cloudflareGeneration) return;
          connectEvents.hidden = report.action !== 'missing';
          eventStatus.textContent = ['ready', 'created'].includes(report.action) ? 'Delivery event subscription connected. Event arrival is not yet verified.' : report.action === 'missing' ? 'No delivery event subscription found for this domain and queue.' : 'Existing subscriptions need review in Cloudflare before connecting.';
        } catch (error) {
          if (generation !== cloudflareGeneration) return;
          const needsAccess = error.code === 'cloudflare_queue_access_required';
          reconnect.hidden = !needsAccess; accessHelp.hidden = !needsAccess;
          if (needsAccess) connectEvents.hidden = true;
          eventStatus.textContent = needsAccess ? 'Cloudflare denied access to this installation’s delivery queue. Reconnect to review access, then retry.' : error.message;
        }
        finally { checkEvents.disabled = false; connectEvents.disabled = false; }
      };
      checkEvents.addEventListener('click', () => check('GET'));
      connectEvents.addEventListener('click', () => { if (window.confirm(`Connect delivery events for ${domain.name} to this installation's queue?`)) void check('POST'); });
      const actions = document.createElement('div'); actions.className = 'domain-delivery-actions';
      actions.append(checkEvents, connectEvents, reconnect, eventStatus, accessHelp); item.append(actions);
    }
    const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Expected DNS records';
    const content = document.createElement('div'); content.textContent = 'Open to load expected records. Their presence and delivery are not verified.'; details.append(summary, content);
    let loadingDns = false;
    details.addEventListener('toggle', async () => {
      if (!details.open || details.dataset.loaded || loadingDns) return;
      loadingDns = true; content.textContent = 'Loading expected DNS records…';
      try {
        const records = await api(`/api/cloudflare/zones/${encodeURIComponent(zone)}/domains/${encodeURIComponent(domain.tag)}/dns`);
        if (generation !== cloudflareGeneration) return;
        if (!Array.isArray(records.data) || records.data.some(record => !record || typeof record.type !== 'string' || typeof record.name !== 'string' || typeof record.content !== 'string')) throw new Error('Unexpected DNS response.');
        content.replaceChildren(); const note = document.createElement('p'); note.textContent = 'Expected records from Cloudflare. DNS and delivery are not verified.'; content.append(note);
        if (!records.data.length) { const empty = document.createElement('p'); empty.textContent = 'Cloudflare returned no expected records.'; content.append(empty); }
        if (records.incomplete === true) { const warning = document.createElement('p'); warning.textContent = 'Cloudflare may have returned an incomplete list. Check Cloudflare for additional records.'; content.append(warning); }
        for (const record of records.data) { const line = document.createElement('p'); line.textContent = `${record.type} · ${record.name} · ${record.content}${record.priority == null ? '' : ` · priority ${record.priority}`}`; content.append(line); }
        if (records.data.length) {
          const check = document.createElement('button'); check.type = 'button'; check.textContent = 'Check public DNS';
          const result = document.createElement('div'); result.setAttribute('aria-live', 'polite');
          check.addEventListener('click', async () => {
            check.disabled = true; result.textContent = 'Checking Cloudflare public DNS…';
            try {
              const report = await api(`/api/cloudflare/zones/${encodeURIComponent(zone)}/domains/${encodeURIComponent(domain.tag)}/dns/check`);
              if (generation !== cloudflareGeneration) return;
              if (!Array.isArray(report.data)) throw new Error('Unexpected DNS check response.');
              result.replaceChildren();
              const note = document.createElement('p'); note.textContent = 'Public DNS results can be cached and do not confirm email delivery.'; result.append(note);
              if (report.incomplete) { const warning = document.createElement('p'); warning.textContent = 'This check covers an incomplete list of expected records. Check Cloudflare for the remaining records.'; result.append(warning); }
              for (const record of report.data) { const line = document.createElement('p'); line.textContent = `${record.type} · ${record.name} · ${record.status}`; result.append(line); }
            } catch (error) { if (generation === cloudflareGeneration) result.textContent = error.message; }
            finally { check.disabled = false; }
          });
          content.append(check, result);
        }
        details.dataset.loaded = 'true';
      } catch (error) { if (generation === cloudflareGeneration) content.textContent = `${error.message} Close and reopen to retry.`; }
      finally { loadingDns = false; }
    });
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button'; remove.textContent = 'Disable sending'; remove.setAttribute('aria-label', `Disable sending for ${domain.name}`);
    remove.addEventListener('click', async () => {
      if (!window.confirm(`Disable Email Sending for ${domain.name}? Cloudflare may remove sending DNS records. Other services using this domain can be affected.`)) return;
      remove.disabled = true; $('#cloudflare-status').textContent = 'Disabling sending domain…';
      try { await api(`/api/cloudflare/zones/${encodeURIComponent(zone)}/domains/${encodeURIComponent(domain.tag)}`, { method: 'DELETE' }); if (generation !== cloudflareGeneration) return; item.remove(); $('#cloudflare-status').textContent = 'Cloudflare accepted the request to disable sending.'; }
      catch (error) { if (generation === cloudflareGeneration) $('#cloudflare-status').textContent = `${error.message} Check the domain before retrying.`; }
      finally { remove.disabled = false; }
    });
    item.append(details, remove); list.append(item);
  }
  return result.incomplete === true;
}
$('#cloudflare-selected-zone').addEventListener('change', () => { cloudflareGeneration++; $('#cloudflare-domain-list').replaceChildren(); $('#cloudflare-suppression-list').replaceChildren(); $('#cloudflare-more-suppressions').hidden = true; suppressionCursor = null; });
$('#cloudflare-load-domains').addEventListener('click', async event => {
  const button = event.currentTarget; button.disabled = true; $('#cloudflare-status').textContent = 'Loading sending domains…';
  try { const incomplete = await loadCloudflareDomains(); if (incomplete === null) return; $('#cloudflare-status').textContent = incomplete ? 'Cloudflare may have returned an incomplete list. Check Cloudflare for additional domains.' : 'Sending domains loaded.'; } catch (error) { $('#cloudflare-status').textContent = error.message; }
  finally { button.disabled = false; }
});
$('#cloudflare-domain-form').addEventListener('submit', async event => {
  event.preventDefault(); const zone = $('#cloudflare-selected-zone'); const name = $('#cloudflare-domain-name').value.trim();
  if (!window.confirm(`Enable Email Sending for ${name} in ${zone.selectedOptions[0].textContent}? Cloudflare may create sending DNS records shared with other services.`)) return;
  const generation = cloudflareGeneration; const button = event.currentTarget.querySelector('button'); button.disabled = true; $('#cloudflare-status').textContent = 'Enabling sending domain…';
  try { await api(`/api/cloudflare/zones/${encodeURIComponent(zone.value)}/domains`, { method: 'POST', body: JSON.stringify({ name }) }); if (generation !== cloudflareGeneration) return; $('#cloudflare-domain-name').value = ''; const incomplete = await loadCloudflareDomains(); $('#cloudflare-status').textContent = `Cloudflare accepted the configuration. DNS and delivery readiness are not yet verified.${incomplete ? ' The list may be incomplete.' : ''}`; }
  catch (error) { if (generation === cloudflareGeneration) $('#cloudflare-status').textContent = `${error.message} Check the domain list before retrying.`; }
  finally { button.disabled = false; }
});
let suppressionCursor = null;
async function loadCloudflareSuppressions(reset) {
  const zone = $('#cloudflare-selected-zone').value; const generation = cloudflareGeneration;
  const params = new URLSearchParams(); if (!reset && suppressionCursor) params.set('cursor', suppressionCursor);
  const result = await api(`/api/cloudflare/zones/${encodeURIComponent(zone)}/suppressions${params.size ? `?${params}` : ''}`);
  if (generation !== cloudflareGeneration || zone !== $('#cloudflare-selected-zone').value) return;
  const list = $('#cloudflare-suppression-list'); if (reset) list.replaceChildren();
  for (const item of result.data) {
    const row = document.createElement('li'); const label = document.createElement('span');
    const scope = item.scope?.type === 'sending_domain' ? `domain: ${item.scope.value}` : item.scope?.type === 'account' ? 'account-wide' : 'scope unknown';
    label.textContent = `${item.email} · ${item.reason} · ${scope} · ${item.read_only === true ? 'Read only' : item.read_only === false ? 'Editable in Cloudflare' : 'Mutability unknown'}`; row.append(label);
    if (item.read_only === false && typeof item.id === 'string' && /^[a-f0-9-]{36}$/i.test(item.id)) {
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button'; remove.textContent = 'Remove'; remove.setAttribute('aria-label', `Remove suppression for ${item.email} (${scope})`);
      remove.addEventListener('click', async () => {
        if (!window.confirm(`Remove suppression for ${item.email} (${scope})? This permits future delivery attempts. Confirm the recipient should receive email first.`)) return;
        remove.disabled = true; $('#cloudflare-status').textContent = 'Removing suppression…';
        try { await api(`/api/cloudflare/zones/${encodeURIComponent(zone)}/suppressions/${encodeURIComponent(item.id)}`, { method: 'DELETE' }); if (generation !== cloudflareGeneration) return; row.remove(); $('#cloudflare-status').textContent = 'Suppression removed. Future delivery attempts are permitted.'; }
        catch (error) { if (generation === cloudflareGeneration) $('#cloudflare-status').textContent = `${error.message} Check the list before retrying.`; }
        finally { remove.disabled = false; }
      }); row.append(remove);
    }
    list.append(row);
  }
  suppressionCursor = result.next_cursor; $('#cloudflare-more-suppressions').hidden = !suppressionCursor;
  $('#cloudflare-status').textContent = result.data.length ? 'Suppressions loaded.' : 'No suppressions on this page.';
}
for (const [id, reset] of [['#cloudflare-load-suppressions', true], ['#cloudflare-more-suppressions', false]]) $(id).addEventListener('click', async event => {
  event.currentTarget.disabled = true; $('#cloudflare-status').textContent = 'Loading suppressions…';
  try { await loadCloudflareSuppressions(reset); } catch (error) { $('#cloudflare-status').textContent = error.message; }
  finally { event.currentTarget.disabled = false; }
});
$('#suppression-scope').addEventListener('change', event => {
  const domainScope = event.currentTarget.value === 'sending_domain';
  $('#suppression-domain-wrap').hidden = !domainScope; $('#suppression-domain').required = domainScope;
});
$('#cloudflare-suppression-form').addEventListener('submit', async event => {
  event.preventDefault(); const email = $('#suppression-email').value.trim(); const selected = $('#suppression-scope').value;
  const scope = selected === 'account' ? { type: 'account' } : { type: 'sending_domain', value: $('#suppression-domain').value.trim().toLowerCase() };
  const expiry = $('#suppression-expiry').value ? new Date($('#suppression-expiry').value) : null;
  if (expiry && (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now())) { $('#cloudflare-status').textContent = 'Choose a future expiration time.'; return; }
  const scopeDescription = scope.type === 'account' ? 'all sending domains in this account' : scope.value;
  if (!window.confirm(`Suppress ${email} for ${scopeDescription}?${expiry ? ` Expires ${expiry.toLocaleString()}.` : ' This suppression does not expire.'}`)) return;
  const generation = cloudflareGeneration; const button = event.currentTarget.querySelector('button'); button.disabled = true; $('#cloudflare-status').textContent = 'Adding suppression…';
  try {
    await api(`/api/cloudflare/zones/${encodeURIComponent($('#cloudflare-selected-zone').value)}/suppressions`, { method: 'POST', body: JSON.stringify({ email, scope, ...(expiry && { expires_at: expiry.toISOString() }) }) });
    if (generation !== cloudflareGeneration) return;
    event.currentTarget.reset(); $('#suppression-domain-wrap').hidden = true; $('#suppression-domain').required = false;
    await loadCloudflareSuppressions(true); $('#cloudflare-status').textContent = 'Suppression accepted by Cloudflare.';
  } catch (error) { if (generation === cloudflareGeneration) $('#cloudflare-status').textContent = `${error.message} Check the list before retrying.`; }
  finally { button.disabled = false; }
});
let composeKey = null;
let composeDirty = false;
function updateComposeMode() {
  const template = $('#compose-mode').value === 'template';
  $('#compose-manual').hidden = template;
  $('#compose-template-fields').hidden = !template;
  $('#compose-template').required = template;
  $('#compose-from').required = !template; $('#compose-subject').required = !template;
  $('#compose-default-help').hidden = !template;
}
$('#compose-mode').addEventListener('change', updateComposeMode);
let composeTemplateCursor = null;
let composeTemplateQuery = '';
let composeTemplateGeneration = 0;
function resetComposeTemplatePicker() {
  composeTemplateGeneration++; composeTemplateCursor = null; composeTemplateQuery = '';
  $('#compose-template-picker').hidden = true;
  $('#compose-browse-templates').setAttribute('aria-expanded', 'false');
  $('#compose-template-list').replaceChildren(); $('#compose-template-list-status').textContent = '';
  $('#compose-template-more').hidden = true; $('#compose-template-search').value = '';
}
async function loadComposeTemplates(append = false) {
  const generation = ++composeTemplateGeneration;
  const params = new URLSearchParams({ status: 'published', limit: '20' });
  if (!append) composeTemplateQuery = $('#compose-template-search').value.trim();
  if (composeTemplateQuery) params.set('name', composeTemplateQuery);
  if (append && composeTemplateCursor) params.set('after', composeTemplateCursor);
  const status = $('#compose-template-list-status'); status.textContent = 'Loading templates…';
  const result = await api(`/api/templates?${params}`);
  if (generation !== composeTemplateGeneration) return;
  const list = $('#compose-template-list'); if (!append) list.replaceChildren();
  for (const template of result.data) {
    const item = document.createElement('li'); const label = document.createElement('span'); label.textContent = template.name;
    const use = document.createElement('button'); use.type = 'button'; use.className = 'text-button'; use.textContent = 'Use'; use.setAttribute('aria-label', `Use ${template.name}`);
    use.addEventListener('click', () => {
      const field = $('#compose-template'); field.value = template.id; field.dispatchEvent(new Event('input', { bubbles: true }));
      resetComposeTemplatePicker(); field.focus();
    });
    item.append(label, use); list.append(item);
  }
  composeTemplateCursor = result.data.at(-1)?.id || null;
  $('#compose-template-more').hidden = !result.has_more;
  $('#compose-template-more').disabled = $('#compose-template-search').value.trim() !== composeTemplateQuery;
  status.textContent = list.children.length ? '' : 'No published templates match this search.';
}
$('#compose-browse-templates').addEventListener('click', async () => {
  const picker = $('#compose-template-picker');
  if (!picker.hidden) { resetComposeTemplatePicker(); return; }
  picker.hidden = false; $('#compose-browse-templates').setAttribute('aria-expanded', 'true');
  try { await loadComposeTemplates(); } catch (error) { $('#compose-template-list-status').textContent = error.message; }
});
$('#compose-template-search').addEventListener('input', event => {
  $('#compose-template-more').disabled = event.target.value.trim() !== composeTemplateQuery;
});
$('#compose-template-search').addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); $('#compose-template-search-button').click(); }
});
$('#compose-template-search-button').addEventListener('click', async () => {
  try { await loadComposeTemplates(); } catch (error) { $('#compose-template-list-status').textContent = error.message; }
});
$('#compose-template-more').addEventListener('click', async event => {
  event.currentTarget.disabled = true;
  try { await loadComposeTemplates(true); } catch (error) { $('#compose-template-list-status').textContent = error.message; }
  finally { event.currentTarget.disabled = false; }
});

let composeReplyHeaders = null;
function resetComposeReply() {
  composeReplyHeaders = null; $('#compose-reply-context').hidden = true;
  $('#compose-reply-note').textContent = ''; $('#compose-reply-headers').textContent = '';
}
$('#compose-clear-reply').addEventListener('click', () => {
  resetComposeReply(); composeKey = null; composeDirty = true; $('#compose-to').focus();
});
function openReply(received) {
  if ($('#compose-fields').disabled) throw new Error('Wait for the current send to finish before preparing a reply.');
  const draft = replyDraft(received);
  if (composeDirty && !window.confirm('Replace the unsaved email with this reply draft?')) return;
  $('#compose-form').reset(); resetComposeReply(); resetComposeTags(); resetComposeTemplatePicker(); updateComposeMode();
  $('#compose-to').value = draft.to.join(', '); $('#compose-subject').value = draft.subject;
  composeReplyHeaders = draft.headers; $('#compose-reply-context').hidden = false;
  $('#compose-reply-note').textContent = draft.note;
  $('#compose-reply-headers').textContent = Object.entries(draft.headers).map(([name, value]) => `${name}: ${value}`).join('\n') || 'Threading headers unavailable.';
  composeKey = null; composeDirty = true; $('#compose-status').textContent = '';
  history.pushState(null, '', '/dashboard/compose'); showDashboardPage('compose'); $('#compose-from').focus();
}

let composeTagSequence = 0;
function resetComposeTags() {
  $('#compose-tag-list').replaceChildren(); $('#compose-tags').open = false;
  $('#compose-add-tag').disabled = false; $('#compose-tag-count').textContent = '0 of 100 tags';
  composeTagSequence = 0;
}
function updateComposeTags() {
  const count = $('#compose-tag-list').children.length;
  $('#compose-add-tag').disabled = count >= 100;
  $('#compose-tag-count').textContent = `${count} of 100 tags`;
  $('#compose-form').dispatchEvent(new Event('input', { bubbles: true }));
}
$('#compose-add-tag').addEventListener('click', () => {
  const list = $('#compose-tag-list'); if (list.children.length >= 100) return;
  const number = ++composeTagSequence;
  const row = document.createElement('div'); row.className = 'compose-tag'; row.setAttribute('role', 'group'); row.setAttribute('aria-label', `Tag ${number}`);
  for (const name of ['name', 'value']) {
    const field = document.createElement('div'); const input = document.createElement('input'); const label = document.createElement('label');
    input.id = `compose-tag-${name}-${number}`; input.dataset.tagField = name; input.required = true; input.maxLength = 256; input.pattern = '[A-Za-z0-9_\\-]{1,256}'; input.setAttribute('aria-describedby', 'compose-tags-help');
    label.htmlFor = input.id; label.textContent = `Tag ${name} ${number}`; field.append(label, input); row.append(field);
  }
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button'; remove.textContent = 'Remove'; remove.setAttribute('aria-label', `Remove tag ${number}`);
  remove.addEventListener('click', () => {
    const next = row.nextElementSibling || row.previousElementSibling;
    row.remove(); updateComposeTags(); (next?.querySelector('input') || $('#compose-add-tag')).focus();
  });
  row.append(remove); list.append(row); updateComposeTags(); row.querySelector('input').focus();
});
$('#compose-form').addEventListener('invalid', event => {
  if (event.target.closest('#compose-tags')) $('#compose-tags').open = true;
}, true);

$('#compose-form').addEventListener('input', event => { if (!event.target.closest('#compose-template-picker')) { composeKey = null; composeDirty = true; } });
$('#compose-form').addEventListener('change', event => { if (!event.target.closest('#compose-template-picker')) { composeKey = null; composeDirty = true; } });
$('#compose-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget; const fields = $('#compose-fields'); const message = $('#compose-status');
  const parseAddresses = value => value.split(',').map(address => address.trim()).filter(Boolean);
  const to = parseAddresses($('#compose-to').value); const cc = parseAddresses($('#compose-cc').value); const bcc = parseAddresses($('#compose-bcc').value);
  const text = $('#compose-text').value; const html = $('#compose-html').value; const files = [...$('#compose-attachments').files];
  const useTemplate = $('#compose-mode').value === 'template';
  let template;
  if (useTemplate) {
    let variables;
    try { variables = JSON.parse($('#compose-variables').value.trim() || '{}'); }
    catch { message.textContent = 'Template variables must be valid JSON.'; $('#compose-variables').focus(); return; }
    if (!variables || typeof variables !== 'object' || Array.isArray(variables)) { message.textContent = 'Template variables must be a JSON object.'; $('#compose-variables').focus(); return; }
    const id = $('#compose-template').value.trim();
    if (!id) { message.textContent = 'Enter a template ID or alias.'; $('#compose-template').focus(); return; }
    template = { id, variables };
  } else if (!text.trim() && !html.trim()) { message.textContent = 'Provide plain text, HTML or both.'; $('#compose-text').focus(); return; }
  if (to.length + cc.length + bcc.length > 50) { message.textContent = 'Use at most 50 recipients across To, Cc and Bcc.'; return; }
  if (files.length > 32 || files.reduce((sum, file) => sum + file.size, 0) > 5 * 1024 * 1024) { message.textContent = 'Use at most 32 files and 5 MiB of attachments. The complete message must also fit Cloudflare limits.'; return; }
  const scheduleInput = $('#compose-schedule'); const schedule = scheduleInput.value ? new Date(scheduleInput.value) : null;
  if (schedule && (!Number.isFinite(schedule.getTime()) || schedule.getTime() <= Date.now() || schedule.getTime() > Date.now() + 30 * 86400000)) { message.textContent = 'Choose a future time within the next 30 days.'; scheduleInput.focus(); return; }
  const sender = $('#compose-from').value.trim(); const subject = $('#compose-subject').value;
  let payload = { ...(sender && { from: sender }), to, ...(subject && { subject }), ...(useTemplate ? { template } : { ...(text && { text }), ...(html && { html }) }), ...(cc.length && { cc }), ...(bcc.length && { bcc }), ...($('#compose-reply').value.trim() && { reply_to: $('#compose-reply').value.trim() }) };
  const tags = [...$('#compose-tag-list').children].map(row => ({ name: row.querySelector('[data-tag-field=name]').value, value: row.querySelector('[data-tag-field=value]').value }));
  if (tags.length) payload.tags = tags;
  if (composeReplyHeaders && Object.keys(composeReplyHeaders).length) payload.headers = { ...composeReplyHeaders };
  fields.disabled = true;
  if (useTemplate) {
    message.textContent = 'Preparing published template…';
    try { payload = await api('/api/send/prepare', { method: 'POST', body: JSON.stringify(payload) }); }
    catch (error) { message.textContent = `${error.message} No email was sent.`; fields.disabled = false; return; }
  }
  if (schedule) payload.scheduled_at = schedule.toISOString();
  if (!window.confirm(`${schedule ? `Schedule this transactional email for ${schedule.toLocaleString()}?` : 'Send this transactional email now?'}\nFrom: ${payload.from}\nTo: ${to.join(', ')}\nCc: ${cc.join(', ') || 'None'}\nBcc: ${bcc.join(', ') || 'None'}\nSubject: ${payload.subject}${useTemplate ? `\nPublished template: ${template.id}` : ''}`)) { fields.disabled = false; message.textContent = ''; return; }
  composeKey ??= crypto.randomUUID(); message.textContent = 'Sending…';
  try {
    if (files.length) payload.attachments = await Promise.all(files.map(file => new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onerror = () => reject(new Error('Could not read attachment.')); reader.onload = () => resolve({ filename: file.name, content: String(reader.result).split(',')[1], content_type: file.type || 'application/octet-stream' }); reader.readAsDataURL(file);
    })));
    const result = await api('/api/send', { method: 'POST', headers: { 'Idempotency-Key': composeKey }, body: JSON.stringify(payload) });
    form.reset(); resetComposeReply(); resetComposeTags(); resetComposeTemplatePicker(); updateComposeMode(); composeKey = null; composeDirty = false; message.textContent = schedule ? `Scheduled for ${schedule.toLocaleString()}. Email ID: ${result.id}. Delivery is not yet confirmed.` : `Accepted by Cloudflare. Email ID: ${result.id}. Delivery is not yet confirmed.`;
    try { await loadHistory(true); } catch { /* The email was accepted even if the history refresh fails. */ }
  } catch (error) { message.textContent = `${error.message} Check history before trying again; sending may be uncertain.`; }
  finally { fields.disabled = false; }
});
let metricsRows = null;
function clearMetricsReport() {
  metricsRows = null; $('#metrics-trend').hidden = true; $('#metrics-totals').hidden = true;
  $('#metrics-trend-summary').textContent = ''; $('#metrics-scale-max').textContent = ''; $('#metrics-dates').replaceChildren();
  $('#metrics-value-heading').textContent = 'Count'; $('#metrics-table-caption').textContent = ''; $('#metrics-chart').removeAttribute('aria-label');
  $('#metrics-daily-rows').replaceChildren(); $('#metrics-line').removeAttribute('points');
}
function renderMetricsTrend() {
  if (!metricsRows) return;
  const key = $('#metrics-series').value;
  const label = metricLabels[key];
  const plot = metricPlot(metricsRows, key);
  $('#metrics-scale-max').textContent = new Intl.NumberFormat().format(plot.max);
  $('#metrics-line').setAttribute('points', plot.points);
  $('#metrics-chart').setAttribute('aria-label', `${label} by UTC day`);
  const peak = Math.max(0, ...metricsRows.map(row => row[key]));
  $('#metrics-trend-summary').textContent = peak ? `Peak daily count: ${new Intl.NumberFormat().format(peak)}. Exact values are available below.` : `No ${label.toLowerCase()} recorded in this interval.`;
  const dates = $('#metrics-dates'); dates.replaceChildren();
  const formatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  for (const index of [...new Set([0, Math.floor((metricsRows.length - 1) / 2), metricsRows.length - 1])]) {
    if (!metricsRows[index]) continue;
    const time = document.createElement('time'); time.dateTime = metricsRows[index].period;
    time.textContent = formatter.format(new Date(time.dateTime)); dates.append(time);
  }
  $('#metrics-value-heading').textContent = label;
  $('#metrics-table-caption').textContent = `${label} per UTC day`;
  const body = $('#metrics-daily-rows'); body.replaceChildren();
  for (const row of metricsRows) {
    const tr = document.createElement('tr'); const date = document.createElement('th'); date.scope = 'row'; date.textContent = row.period.slice(0, 10);
    const count = document.createElement('td'); count.textContent = new Intl.NumberFormat().format(row[key]);
    tr.append(date, count); body.append(tr);
  }
  $('#metrics-trend').hidden = false;
}
for (const [value, label] of Object.entries(metricLabels)) {
  const option = document.createElement('option'); option.value = value; option.textContent = label; $('#metrics-series').append(option);
}
$('#metrics-series').addEventListener('change', renderMetricsTrend);
let metricsGeneration = 0;
$('#metrics-form').addEventListener('submit', async event => {
  event.preventDefault();
  const generation = ++metricsGeneration;
  const button = event.currentTarget.querySelector('button');
  const output = $('#metrics-results');
  const message = $('#metrics-status');
  button.disabled = true; output.replaceChildren(); clearMetricsReport(); message.textContent = 'Loading overview…';
  const end = new Date();
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) - (Number($('#metrics-range').value) - 1) * 86400000);
  const params = new URLSearchParams({ start_date: start.toISOString(), end_date: end.toISOString(), dimensions: 'period', granularity: 'daily' });
  try {
    const result = await api(`/api/history/metrics?${params}`);
    if (generation !== metricsGeneration) return;
    metricsRows = dailyMetricRows(result); renderMetricsTrend();
    for (const [key, label] of Object.entries(metricLabels)) {
      const item = document.createElement('div'); const term = document.createElement('dt'); const value = document.createElement('dd');
      term.textContent = label; value.textContent = new Intl.NumberFormat().format(result.totals[key]); item.append(term, value); output.append(item);
    }
    $('#metrics-totals').hidden = false;
    message.textContent = `UTC interval: ${new Date(result.start_date).toISOString().slice(0, 10)} to ${new Date(result.end_date).toISOString().replace('T', ' ').slice(0, 19)}.`;
  } catch (error) { if (generation === metricsGeneration) message.textContent = error.message; }
  finally { button.disabled = false; }
});
async function loadKeys() {
  const { data } = await api('/api/keys');
  const list = $('#key-list');
  list.replaceChildren();
  $('#empty-keys').hidden = data.length > 0;
  for (const key of data) {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = `${key.name} · ${key.permission === 'sending_access' ? 'Send only' : 'Full access'}${key.sending_domain ? ` · ${key.sending_domain}` : ''}`;
    const rename = document.createElement('button');
    rename.type = 'button'; rename.className = 'text-button'; rename.textContent = 'Rename';
    rename.setAttribute('aria-label', `Rename ${key.name}`);
    rename.addEventListener('click', async () => {
      const value = window.prompt('New key name (up to 50 characters)', key.name);
      if (value === null) return;
      if (!value.trim() || value.length > 50) { announce('Enter a name of 1-50 characters.'); return; }
      rename.disabled = true;
      try { await api(`/api/keys/${encodeURIComponent(key.id)}`, { method: 'PATCH', body: JSON.stringify({ name: value }) }); await loadKeys(); announce('Key renamed.'); }
      catch (error) { announce(error.message); }
      finally { rename.disabled = false; }
    });
    const revoke = document.createElement('button');
    revoke.type = 'button'; revoke.className = 'text-button'; revoke.textContent = 'Revoke';
    revoke.setAttribute('aria-label', `Revoke ${key.name}`);
    revoke.addEventListener('click', async () => {
      if (!window.confirm(`Revoke “${key.name}”? Applications using it will stop working.`)) return;
      try { await api(`/api/keys/${encodeURIComponent(key.id)}`, { method: 'DELETE' }); $('#new-key').hidden = true; $('#key-value').textContent = ''; await loadKeys(); announce('Key revoked.'); }
      catch (error) { announce(error.message); }
    });
    const actions = document.createElement('div'); actions.append(rename, revoke);
    item.append(name, actions); list.append(item);
  }
}
function createEmailRecord(subject, recipient, state, createdAt, latestEvent = null) {
  const record = document.createElement('details'); record.className = 'email-record';
  const summary = document.createElement('summary');
  const title = document.createElement('strong'); title.textContent = subject || '(No subject)';
  const address = document.createElement('span'); address.className = 'record-recipient'; address.textContent = recipient;
  const status = document.createElement('span'); status.className = 'record-status'; status.dataset.state = state;
  status.textContent = state === 'accepted' ? 'Accepted by Cloudflare' : state.charAt(0).toUpperCase() + state.slice(1);
  if (latestEvent) {
    const event = document.createElement('span'); event.className = 'record-event';
    event.textContent = `Latest recipient event: ${latestEvent.charAt(0).toUpperCase() + latestEvent.slice(1)}`;
    status.append(event);
  }
  const time = document.createElement('time'); time.dateTime = createdAt;
  time.textContent = new Date(createdAt).toLocaleString();
  summary.append(title, address, status, time);
  const content = document.createElement('div'); content.className = 'record-content';
  record.append(summary, content);
  return { record, content };
}
let historyCursor = null;
let historyFilters = {};
let historyGeneration = 0;
async function loadHistory(reset = false) {
  const generation = reset ? ++historyGeneration : historyGeneration;
  const message = $('#history-status');
  message.textContent = 'Loading email attempts…';
  const params = new URLSearchParams({ limit: '20' });
  for (const [key, value] of Object.entries(historyFilters)) params.set(key, value);
  if (!reset && historyCursor) params.set('after', historyCursor);
  const result = await api(`/api/history?${params}`);
  if (generation !== historyGeneration) return;
  const list = $('#history-list');
  if (reset) list.replaceChildren();
  for (const email of result.data) {
    const item = document.createElement('li');
    const { record, content: recordContent } = createEmailRecord(email.subject, email.to.join(', '), email.status, email.created_at, email.last_event);
    const attempt = document.createElement('p'); attempt.textContent = `Attempt: ${email.status}. Latest recipient event: ${email.last_event || 'Not recorded'}.`;
    recordContent.append(attempt);
    const recipients = document.createElement('details');
    const recipientsSummary = document.createElement('summary'); recipientsSummary.textContent = 'Recipients and reply address';
    const recipientsContent = document.createElement('div'); recipientsContent.className = 'delivery-events';
    recipients.append(recipientsSummary, recipientsContent);
    recipients.addEventListener('toggle', async () => {
      if (!recipients.open || recipients.dataset.loaded || recipients.dataset.loading) return;
      recipients.dataset.loading = 'true'; recipientsContent.textContent = 'Loading recipients…';
      try {
        const result = await api(`/api/history/${encodeURIComponent(email.id)}`);
        recipientsContent.replaceChildren();
        for (const [label, addresses] of [['Cc', result.cc], ['Bcc', result.bcc], ['Reply to', result.reply_to === null ? (result.cc === null ? null : []) : [result.reply_to]]]) {
          const line = document.createElement('p');
          line.textContent = `${label}: ${addresses === null ? 'Not recorded' : addresses.length ? addresses.join(', ') : 'None'}`;
          recipientsContent.append(line);
        }
        recipients.dataset.loaded = 'true';
      } catch (error) { recipientsContent.textContent = `${error.message} Close and reopen to retry.`; }
      finally { delete recipients.dataset.loading; }
    });
    const bodyDetails = document.createElement('details');
    const bodySummary = document.createElement('summary'); bodySummary.textContent = 'Message content';
    const bodyContent = document.createElement('div'); bodyContent.className = 'delivery-events';
    bodyDetails.append(bodySummary, bodyContent);
    bodyDetails.addEventListener('toggle', async () => {
      if (!bodyDetails.open || bodyDetails.dataset.loaded || bodyDetails.dataset.loading) return;
      bodyDetails.dataset.loading = 'true'; bodyContent.textContent = 'Loading message content…';
      try {
        const result = await api(`/api/history/${encodeURIComponent(email.id)}`);
        bodyContent.replaceChildren();
        for (const [label, value] of [['Text', result.text], ['HTML source', result.html]]) {
          if (typeof value !== 'string') continue;
          const heading = document.createElement('strong'); heading.textContent = label;
          const pre = document.createElement('pre'); pre.className = 'inbox-body'; pre.textContent = value;
          bodyContent.append(heading, pre);
        }
        const tagsHeading = document.createElement('strong'); tagsHeading.textContent = 'Tags'; bodyContent.append(tagsHeading);
        if (result.tags?.length) {
          const tags = document.createElement('dl'); tags.className = 'message-tags';
          for (const tag of result.tags) {
            const name = document.createElement('dt'); name.textContent = tag.name;
            const value = document.createElement('dd'); value.textContent = tag.value; tags.append(name, value);
          }
          bodyContent.append(tags);
        } else {
          const empty = document.createElement('p'); empty.textContent = 'No tags recorded.'; bodyContent.append(empty);
        }
        if (result.attachments?.length) {
          const heading = document.createElement('strong'); heading.textContent = 'Attachments'; bodyContent.append(heading);
          const list = document.createElement('ul');
          for (const attachment of result.attachments) {
            const row = document.createElement('li'); const link = document.createElement('a');
            link.href = `/api/history/${encodeURIComponent(email.id)}/attachments/${encodeURIComponent(attachment.id)}`;
            link.textContent = `${attachment.filename || 'Attachment'} (${attachment.size} bytes)`; link.setAttribute('download', ''); row.append(link); list.append(row);
          }
          bodyContent.append(list);
        }
        if (typeof result.text !== 'string' && typeof result.html !== 'string' && !result.attachments?.length) { const unavailable = document.createElement('p'); unavailable.textContent = 'Content is unavailable for this message.'; bodyContent.append(unavailable); }
        bodyDetails.dataset.loaded = 'true';
      } catch (error) { bodyContent.textContent = `${error.message} Close and reopen to retry.`; }
      finally { delete bodyDetails.dataset.loading; }
    });
    const details = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = 'Delivery events';
    const content = document.createElement('div'); content.className = 'delivery-events';
    details.append(summary, content);
    details.addEventListener('toggle', async () => {
      if (!details.open || details.dataset.loaded === 'true' || details.dataset.loading === 'true') return;
      details.dataset.loading = 'true'; content.textContent = 'Loading delivery events…';
      try {
        content.replaceChildren();
        const events = document.createElement('ul'); content.append(events);
        let cursor = null;
        const more = document.createElement('button'); more.type = 'button'; more.className = 'text-button'; more.textContent = 'Load more events';
        const load = async () => {
          more.disabled = true;
          try {
            const params = new URLSearchParams({ limit: '20' }); if (cursor) params.set('after', cursor);
            const result = await api(`/api/history/${encodeURIComponent(email.id)}/events?${params}`);
            for (const event of result.data) {
              const row = document.createElement('li');
              row.textContent = `${event.recipient} · ${event.type} · ${new Date(event.occurred_at).toLocaleString()}`;
              if (event.details && Object.keys(event.details).length) {
                const diagnostics = document.createElement('span');
                diagnostics.textContent = Object.entries(event.details).map(([key, value]) => `${key.replaceAll('_', ' ')}: ${value}`).join(' · ');
                row.append(diagnostics);
              }
              events.append(row);
            }
            cursor = result.data.at(-1)?.id || cursor; more.hidden = !result.has_more;
            if (!events.children.length) { const empty = document.createElement('p'); empty.textContent = 'No delivery events recorded. A Cloudflare event subscription is required.'; content.prepend(empty); }
          } finally { more.disabled = false; }
        };
        more.addEventListener('click', async () => { try { await load(); } catch (error) { message.textContent = error.message; } });
        content.append(more); await load();
        details.dataset.loaded = 'true';
      } catch (error) { content.textContent = `${error.message} Close and reopen to retry.`; }
      finally { delete details.dataset.loading; }
    });
    if (email.status === 'scheduled' && email.scheduled_at) {
      const when = document.createElement('span');
      when.textContent = `Scheduled for ${new Date(email.scheduled_at).toLocaleString()} (your time zone)`;
      recordContent.append(when);
      if (email.preparation_retry_at) {
        const retry = document.createElement('span');
        retry.textContent = `Preparation failed ${email.preparation_attempts} time(s). Retry after ${new Date(email.preparation_retry_at).toLocaleString()} (your time zone). No send was attempted.`;
        recordContent.append(retry);
      }
      const form = document.createElement('form'); form.className = 'schedule-form';
      const label = document.createElement('label'); label.htmlFor = `schedule-${email.id}`; label.textContent = `New send time for ${email.subject}`;
      const input = document.createElement('input'); input.id = label.htmlFor; input.type = 'datetime-local'; input.required = true;
      const date = new Date(email.scheduled_at);
      input.value = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      const save = document.createElement('button'); save.type = 'submit'; save.className = 'secondary'; save.textContent = 'Reschedule';
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'text-button'; cancel.textContent = 'Cancel scheduled email';
      cancel.setAttribute('aria-label', `Cancel scheduled email ${email.subject}`);
      form.append(label, input, save, cancel); recordContent.append(form);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const selected = new Date(input.value);
        if (!Number.isFinite(selected.getTime()) || selected.getTime() <= Date.now()) { message.textContent = 'Choose a future send time.'; input.focus(); return; }
        save.disabled = true; cancel.disabled = true;
        try { await api(`/api/history/${encodeURIComponent(email.id)}`, { method: 'PATCH', body: JSON.stringify({ scheduled_at: selected.toISOString() }) }); await loadHistory(true); message.textContent = 'Send time updated.'; }
        catch (error) { message.textContent = error.message; save.disabled = false; cancel.disabled = false; }
      });
      cancel.addEventListener('click', async () => {
        if (!window.confirm(`Cancel scheduled email “${email.subject}”?`)) return;
        save.disabled = true; cancel.disabled = true;
        try { await api(`/api/history/${encodeURIComponent(email.id)}/cancel`, { method: 'POST', body: '{}' }); await loadHistory(true); message.textContent = 'Scheduled email canceled.'; }
        catch (error) { message.textContent = error.message; save.disabled = false; cancel.disabled = false; }
      });
    }
    recordContent.append(bodyDetails, recipients, details); item.append(record); list.append(item);
  }
  historyCursor = result.data.at(-1)?.id || null;
  $('#empty-history').textContent = Object.keys(historyFilters).length ? 'No attempts match these filters.' : 'No email attempts yet.';
  $('#empty-history').hidden = list.children.length > 0;
  $('#load-more').hidden = !result.has_more;
  message.textContent = '';
}
$('#history-filter').addEventListener('submit', async event => {
  event.preventDefault();
  historyFilters = Object.fromEntries([...new FormData(event.currentTarget)].map(([key, value]) => [key, value.trim()]).filter(([, value]) => value));
  try { await loadHistory(true); } catch (error) { $('#history-status').textContent = error.message; }
});
$('#history-clear').addEventListener('click', async () => {
  $('#history-filter').reset(); historyFilters = {};
  try { await loadHistory(true); } catch (error) { $('#history-status').textContent = error.message; }
});
$('#load-more').addEventListener('click', async () => {
  const button = $('#load-more'); button.disabled = true;
  try { await loadHistory(); } catch (error) { $('#history-status').textContent = error.message; }
  finally { button.disabled = false; }
});
let editingWebhookId = null;
let webhookCursor = null;
function resetWebhookForm() { editingWebhookId = null; $('#webhook-form').reset(); $('#webhook-form-title').textContent = 'Create webhook'; $('#webhook-form button[type=submit]').textContent = 'Create webhook'; $('#cancel-webhook-edit').hidden = true; }
$('#cancel-webhook-edit').addEventListener('click', () => { resetWebhookForm(); $('#webhook-status').textContent = 'Edit canceled.'; });
async function loadWebhooks(append = false) {
  const params = new URLSearchParams({ limit: '20' }); if (append && webhookCursor) params.set('after', webhookCursor);
  const result = await api(`/api/webhooks?${params}`); const list = $('#webhook-list'); if (!append) list.replaceChildren();
  webhookCursor = result.data.at(-1)?.id || null; $('#more-webhooks').hidden = !result.has_more;
  $('#empty-webhooks').hidden = list.children.length > 0 || result.data.length > 0;
  for (const webhook of result.data) {
    const item = document.createElement('li'); const endpoint = document.createElement('strong'); endpoint.textContent = webhook.endpoint;
    const events = document.createElement('span'); events.textContent = `${webhook.status} · ${webhook.events.join(', ')}`;
    const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Delivery attempts';
    const content = document.createElement('div'); details.append(summary, content);
    details.addEventListener('toggle', async () => {
      if (!details.open || details.dataset.loaded || details.dataset.loading) return;
      details.dataset.loading = 'true'; content.textContent = 'Loading delivery attempts…';
      try {
        content.replaceChildren(); const rows = document.createElement('ul'); content.append(rows);
        const more = document.createElement('button'); more.type = 'button'; more.className = 'text-button'; more.textContent = 'Load more attempts'; let cursor = null;
        const load = async () => {
          more.disabled = true;
          try {
            const params = new URLSearchParams({ limit: '20' }); if (cursor) params.set('after', cursor);
            const page = await api(`/api/webhooks/${encodeURIComponent(webhook.id)}/deliveries?${params}`);
            for (const delivery of page.data) {
              const row = document.createElement('li'); const label = document.createElement('span'); label.textContent = `${delivery.event_type} · ${delivery.state} · ${delivery.attempts} attempts${delivery.last_status ? ` · HTTP ${delivery.last_status}` : ''} · ${new Date(delivery.occurred_at).toLocaleString()}`;
              const payloadDetails = document.createElement('details'); const payloadSummary = document.createElement('summary'); payloadSummary.textContent = 'Saved payload';
              const payloadContent = document.createElement('pre'); payloadContent.className = 'webhook-payload'; payloadDetails.append(payloadSummary, payloadContent);
              payloadDetails.addEventListener('toggle', async () => {
                if (!payloadDetails.open || payloadDetails.dataset.loaded || payloadDetails.dataset.loading) return;
                payloadDetails.dataset.loading = 'true'; payloadContent.textContent = 'Loading payload…';
                try {
                  const result = await api(`/api/webhooks/${encodeURIComponent(webhook.id)}/deliveries/${encodeURIComponent(delivery.id)}`);
                  payloadContent.textContent = result.payload === null ? 'No payload recorded yet. Older deliveries may not have a saved payload.' : JSON.stringify(result.payload, null, 2);
                  payloadDetails.dataset.loaded = 'true';
                } catch (error) { payloadContent.textContent = `${error.message} Close and reopen to retry.`; }
                finally { delete payloadDetails.dataset.loading; }
              });
              const attemptDetails = document.createElement('details'); const attemptSummary = document.createElement('summary'); attemptSummary.textContent = 'Attempt history';
              const attemptContent = document.createElement('div'); attemptDetails.append(attemptSummary, attemptContent);
              attemptDetails.addEventListener('toggle', async () => {
                if (!attemptDetails.open || attemptDetails.dataset.loaded || attemptDetails.dataset.loading) return;
                attemptDetails.dataset.loading = 'true'; attemptContent.textContent = 'Loading attempt history…';
                try {
                  const result = await api(`/api/webhooks/${encodeURIComponent(webhook.id)}/deliveries/${encodeURIComponent(delivery.id)}/attempts`);
                  attemptContent.replaceChildren();
                  if (!result.data.length) attemptContent.textContent = 'No individual attempts recorded. Older attempts are unavailable.';
                  for (const attempt of result.data) { const line = document.createElement('p'); line.textContent = `Attempt ${attempt.attempt_number} · ${new Date(attempt.attempted_at).toLocaleString()} · ${attempt.status === null ? attempt.error : `HTTP ${attempt.status}`}`; attemptContent.append(line); if (attempt.response) { const response = document.createElement('pre'); response.className = 'webhook-payload'; response.textContent = `${attempt.response}${attempt.response_truncated ? '\n[Response truncated]' : ''}`; attemptContent.append(response); } }
                  attemptDetails.dataset.loaded = 'true';
                } catch (error) { attemptContent.textContent = `${error.message} Close and reopen to retry.`; }
                finally { delete attemptDetails.dataset.loading; }
              });
              const replay = document.createElement('button'); replay.type = 'button'; replay.className = 'text-button'; replay.textContent = 'Replay'; replay.setAttribute('aria-label', `Replay ${delivery.event_type} delivery ${delivery.id}`);
              replay.addEventListener('click', async () => {
                if (!window.confirm('Queue another delivery of this event? The existing retry schedule will continue.')) return;
                replay.disabled = true;
                try { await api(`/api/webhooks/${encodeURIComponent(webhook.id)}/deliveries/${encodeURIComponent(delivery.id)}/replay`, { method: 'POST', body: '{}' }); $('#webhook-status').textContent = 'Replay queued. Close and reopen delivery attempts to refresh.'; details.dataset.loaded = ''; }
                catch (error) { $('#webhook-status').textContent = error.message; replay.disabled = false; }
              });
              row.append(label, payloadDetails, attemptDetails, replay); rows.append(row);
            }
            cursor = page.data.at(-1)?.id || cursor; more.hidden = !page.has_more;
            if (!rows.children.length) { const empty = document.createElement('p'); empty.textContent = 'No delivery attempts yet.'; content.prepend(empty); }
          } finally { more.disabled = false; }
        };
        more.addEventListener('click', async () => { try { await load(); } catch (error) { $('#webhook-status').textContent = error.message; } });
        content.append(more); await load(); details.dataset.loaded = 'true';
      } catch (error) { content.textContent = `${error.message} Close and reopen to retry.`; }
      finally { delete details.dataset.loading; }
    });
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'text-button'; edit.textContent = 'Edit'; edit.setAttribute('aria-label', `Edit webhook ${webhook.endpoint}`);
    edit.addEventListener('click', () => {
      $('#webhook-editor').open = true;
      editingWebhookId = webhook.id; $('#webhook-endpoint').value = webhook.endpoint;
      document.querySelectorAll('#webhook-form input[name=event]').forEach(input => { input.checked = webhook.events.includes(input.value); });
      $('#webhook-form-title').textContent = 'Edit webhook'; $('#webhook-form button[type=submit]').textContent = 'Save webhook'; $('#cancel-webhook-edit').hidden = false; $('#webhook-endpoint').focus();
    });
    const rotate = document.createElement('button'); rotate.type = 'button'; rotate.className = 'text-button'; rotate.textContent = 'Rotate secret'; rotate.setAttribute('aria-label', `Rotate secret for ${webhook.endpoint}`);
    rotate.addEventListener('click', async () => {
      if (!window.confirm('Rotate the signing secret? Both secrets remain valid for 24 hours. Copy and configure the new secret.')) return;
      rotate.disabled = true;
      try { const result = await api(`/api/webhooks/${encodeURIComponent(webhook.id)}/rotate-secret`, { method: 'POST', body: '{}' }); $('#webhook-secret-value').textContent = result.signing_secret; $('#webhook-secret').hidden = false; $('#webhook-status').textContent = 'Secret rotated. Copy it now and update your receiver within 24 hours.'; }
      catch (error) { $('#webhook-status').textContent = error.message; }
      finally { rotate.disabled = false; }
    });
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button'; remove.textContent = 'Delete webhook';
    remove.setAttribute('aria-label', `Delete webhook ${webhook.endpoint}`);
    remove.addEventListener('click', async () => {
      if (!window.confirm('Delete this webhook and its pending deliveries?')) return;
      remove.disabled = true;
      try { await api(`/api/webhooks/${encodeURIComponent(webhook.id)}`, { method: 'DELETE' }); await loadWebhooks(); $('#webhook-status').textContent = 'Webhook deleted.'; }
      catch (error) { $('#webhook-status').textContent = error.message; remove.disabled = false; }
    });
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'text-button'; toggle.textContent = webhook.status === 'enabled' ? 'Disable' : 'Enable'; toggle.setAttribute('aria-label', `${toggle.textContent} webhook ${webhook.endpoint}`);
    toggle.addEventListener('click', async () => {
      const status = webhook.status === 'enabled' ? 'disabled' : 'enabled';
      if (status === 'disabled' && !window.confirm('Disable this webhook? Pending deliveries pause and new events are not queued. In-flight requests may finish.')) return;
      toggle.disabled = true;
      try { await api(`/api/webhooks/${encodeURIComponent(webhook.id)}`, { method: 'PATCH', body: JSON.stringify({ status }) }); await loadWebhooks(); $('#webhook-status').textContent = `Webhook ${status}.`; }
      catch (error) { $('#webhook-status').textContent = error.message; toggle.disabled = false; }
    });
    item.append(endpoint, events, details, edit, toggle, rotate, remove); list.append(item);
  }
}
$('#more-webhooks').addEventListener('click', async event => {
  event.currentTarget.disabled = true;
  try { await loadWebhooks(true); } catch (error) { $('#webhook-status').textContent = error.message; }
  finally { event.currentTarget.disabled = false; }
});
$('#webhook-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = $('#webhook-form button[type="submit"]'); button.disabled = true;
  $('#webhook-secret').hidden = true; $('#webhook-secret-value').textContent = '';
  try {
    const events = [...document.querySelectorAll('#webhook-form input[name="event"]:checked')].map(input => input.value);
    if (!events.length) throw new Error('Select at least one event.');
    const editing = editingWebhookId;
    const result = await api(editing ? `/api/webhooks/${encodeURIComponent(editing)}` : '/api/webhooks', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify({ endpoint: $('#webhook-endpoint').value, events }) });
    if (!editing) { $('#webhook-secret-value').textContent = result.signing_secret; $('#webhook-secret').hidden = false; }
    resetWebhookForm(); await loadWebhooks(); $('#webhook-status').textContent = editing ? 'Webhook updated.' : 'Webhook created. Copy the signing secret now.';
  } catch (error) { $('#webhook-status').textContent = error.message; }
  finally { button.disabled = false; }
});
$('#copy-webhook-secret').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#webhook-secret-value').textContent); $('#webhook-status').textContent = 'Signing secret copied.'; }
  catch { $('#webhook-status').textContent = 'Could not copy. Select and copy the secret manually.'; }
});
const inboxDownloads = new Set();
function cancelInboxDownloads() { for (const controller of inboxDownloads) controller.abort(); inboxDownloads.clear(); }
async function downloadInboxOriginal(id, button, message) {
  const controller = new AbortController(); inboxDownloads.add(controller);
  button.disabled = true; button.textContent = 'Downloading…'; message.textContent = 'Downloading original message…';
  try {
    // Refresh on every click: a message can stay open longer than its signed URL is valid.
    const received = await api(`/api/inbox/${encodeURIComponent(id)}`, { signal: controller.signal });
    if (!received.raw) { message.textContent = 'Original download is unavailable for this installation.'; return; }
    const url = new URL(received.raw.download_url);
    if (url.origin !== location.origin || url.username || url.password || url.hash || url.pathname !== `/downloads/receiving/${encodeURIComponent(id)}/raw`) throw new Error('Invalid download URL');
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store' });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('application/octet-stream')) throw new Error('Download failed');
    const blob = await response.blob();
    if (controller.signal.aborted || !button.isConnected) return;
    const objectUrl = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = objectUrl; link.download = `${id}.eml`; link.hidden = true; document.body.append(link); link.click(); link.remove();
    // Let the browser begin consuming the object URL before releasing its temporary backing data.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    message.textContent = 'Download started. Check your browser downloads.';
  } catch {
    if (button.isConnected) message.textContent = controller.signal.aborted ? 'Download canceled.' : 'Could not download original message. Try again.';
  } finally { inboxDownloads.delete(controller); button.disabled = false; button.textContent = 'Download .eml'; }
}
let inboxCursor = null;
let inboxFilters = {};
let inboxGeneration = 0;
async function loadInbox(reset = false) {
  if (reset) cancelInboxDownloads();
  const generation = reset ? ++inboxGeneration : inboxGeneration;
  const message = $('#inbox-status'); message.textContent = 'Loading received email…';
  const params = new URLSearchParams({ limit: '20' });
  for (const [key, value] of Object.entries(inboxFilters)) params.set(key, value);
  if (!reset && inboxCursor) params.set('after', inboxCursor);
  const result = await api(`/api/inbox?${params}`); const list = $('#inbox-list');
  if (generation !== inboxGeneration) return;
  if (reset) list.replaceChildren();
  for (const email of result.data) {
    const item = document.createElement('li');
    const { record, content: recordContent } = createEmailRecord(email.subject, email.sender, 'received', email.created_at);
    const recipient = document.createElement('p'); recipient.textContent = `To: ${email.recipient}`; recordContent.append(recipient);
    const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Read message';
    const content = document.createElement('div'); details.append(summary, content);
    details.addEventListener('toggle', async () => {
      if (!details.open || details.dataset.loaded || details.dataset.loading) return;
      details.dataset.loading = 'true'; content.textContent = 'Loading message…';
      try {
        const received = await api(`/api/inbox/${encodeURIComponent(email.id)}`); content.replaceChildren();
        const reply = document.createElement('button'); reply.type = 'button'; reply.className = 'secondary'; reply.textContent = 'Reply';
        const replyStatus = document.createElement('p'); replyStatus.setAttribute('role', 'status');
        reply.addEventListener('click', () => { try { openReply(received); } catch (error) { replyStatus.textContent = error.message; } });
        const download = document.createElement('button'); download.type = 'button'; download.className = 'secondary'; download.textContent = 'Download .eml';
        download.addEventListener('click', () => downloadInboxOriginal(email.id, download, replyStatus));
        const actions = document.createElement('div'); actions.className = 'inbox-actions'; actions.append(reply, download);
        const note = document.createElement('p'); note.textContent = 'Original .eml includes all headers and attachments.';
        content.prepend(actions, note, replyStatus);
        const body = document.createElement('pre'); body.className = 'inbox-body';
        body.textContent = received.text || received.html || '(No text content)'; content.append(body);
        if (!received.text && received.html) { const note = document.createElement('p'); note.textContent = 'HTML shown as source for safety.'; content.prepend(note); }
        if (received.attachments.length) {
          const heading = document.createElement('strong'); heading.textContent = 'Attachments'; content.append(heading);
          const attachments = document.createElement('ul');
          for (const attachment of received.attachments) {
            const row = document.createElement('li'); const link = document.createElement('a');
            link.href = `/api/inbox/${encodeURIComponent(email.id)}/attachments/${encodeURIComponent(attachment.id)}`;
            link.textContent = `${attachment.filename || 'Attachment'} (${attachment.size} bytes)`; link.setAttribute('download', '');
            row.append(link); attachments.append(row);
          }
          content.append(attachments);
        }
        details.dataset.loaded = 'true';
      } catch (error) { content.textContent = `${error.message} Close and reopen to retry.`; }
      finally { delete details.dataset.loading; }
    });
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button'; remove.textContent = 'Delete message';
    remove.setAttribute('aria-label', `Delete received message ${email.subject || '(No subject)'}`);
    remove.addEventListener('click', async () => {
      if (!window.confirm('Permanently delete this message and its attachments?')) return;
      remove.disabled = true;
      try { await api(`/api/inbox/${encodeURIComponent(email.id)}`, { method: 'DELETE' }); await loadInbox(true); message.textContent = 'Message deleted.'; }
      catch (error) { message.textContent = error.message; remove.disabled = false; }
    });
    recordContent.append(details, remove); item.append(record); list.append(item);
  }
  inboxCursor = result.data.at(-1)?.id || null; $('#inbox-more').hidden = !result.has_more;
  $('#empty-inbox').textContent = Object.keys(inboxFilters).length ? 'No messages match these filters.' : 'No received email. Email Routing must be configured to receive messages.';
  $('#empty-inbox').hidden = list.children.length > 0; message.textContent = '';
}
$('#inbox-filter').addEventListener('submit', async event => {
  event.preventDefault();
  inboxFilters = Object.fromEntries([...new FormData(event.currentTarget)].map(([key, value]) => [key, value.trim()]).filter(([, value]) => value));
  try { await loadInbox(true); } catch (error) { $('#inbox-status').textContent = error.message; }
});
$('#inbox-clear').addEventListener('click', async () => {
  $('#inbox-filter').reset(); inboxFilters = {};
  try { await loadInbox(true); } catch (error) { $('#inbox-status').textContent = error.message; }
});
$('#inbox-more').addEventListener('click', async () => {
  const button = $('#inbox-more'); button.disabled = true;
  try { await loadInbox(); } catch (error) { $('#inbox-status').textContent = error.message; }
  finally { button.disabled = false; }
});
let templateId = null;
let templateDirty = false;
let templateCursor = null;
let templateFilters = {};
let templateGeneration = 0;
const templateForm = $('#template-form');
const templateStatus = $('#template-status');
function confirmDiscard() { return !templateDirty || window.confirm('Discard unsaved template changes?'); }
window.addEventListener('beforeunload', event => {
  if (templateDirty || composeDirty) { event.preventDefault(); event.returnValue = ''; }
});
function updatePublishButton() { $('#publish-template').disabled = !templateId || templateDirty; }
function openTemplate(template = null) {
  templateId = template?.id || null;
  $('#template-preview').hidden = true; $('#template-preview-content').replaceChildren();
  templateDirty = false;
  templateForm.reset();
  $('#template-name').value = template?.name || '';
  $('#template-alias').value = template?.alias || '';
  $('#template-from').value = template?.from || '';
  $('#template-subject').value = template?.subject || '';
  $('#template-html').value = template?.html || '';
  $('#template-text').value = template?.text || '';
  $('#template-variables').value = template?.variables?.length ? JSON.stringify(template.variables, null, 2) : '';
  $('#template-editor-title').textContent = template ? `Edit ${template.name}` : 'New template';
  $('#delete-template').hidden = !template;
  updatePublishButton(); templateForm.hidden = false; $('#template-name').focus();
}
async function loadTemplates(append = false) {
  const generation = ++templateGeneration;
  const params = new URLSearchParams({ limit: '20', ...templateFilters });
  if (append && templateCursor) params.set('after', templateCursor);
  const result = await api(`/api/templates?${params}`);
  if (generation !== templateGeneration) return;
  const list = $('#template-list'); if (!append) list.replaceChildren();
  $('#empty-templates').hidden = list.children.length > 0 || result.data.length > 0;
  $('#empty-templates').textContent = Object.keys(templateFilters).length ? 'No templates match these filters.' : 'No templates yet.';
  templateCursor = result.data.at(-1)?.id || null;
  $('#more-templates').hidden = !result.has_more;
  for (const template of result.data) {
    const item = document.createElement('li');
    const name = document.createElement('span'); name.textContent = `${template.name} · ${template.status}`;
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'text-button'; edit.textContent = 'Edit';
    edit.setAttribute('aria-label', `Edit ${template.name}`);
    edit.addEventListener('click', async () => {
      if (!confirmDiscard()) return;
      try { openTemplate(await api(`/api/templates/${encodeURIComponent(template.id)}`)); templateStatus.textContent = ''; }
      catch (error) { templateStatus.textContent = error.message; }
    });
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'text-button'; copy.textContent = 'Duplicate';
    copy.setAttribute('aria-label', `Duplicate ${template.name}`);
    copy.addEventListener('click', async () => {
      copy.disabled = true;
      try { await api(`/api/templates/${encodeURIComponent(template.id)}/duplicate`, { method: 'POST', body: '{}' }); await loadTemplates(); templateStatus.textContent = 'Unpublished copy created.'; }
      catch (error) { templateStatus.textContent = error.message; }
      finally { copy.disabled = false; }
    });
    const actions = document.createElement('span'); actions.append(edit, copy);
    item.append(name, actions); list.append(item);
  }
}
$('#template-filter').addEventListener('submit', async event => {
  event.preventDefault();
  templateFilters = Object.fromEntries([...new FormData(event.currentTarget)].map(([key, value]) => [key, value.trim()]).filter(([, value]) => value));
  try { await loadTemplates(); } catch (error) { templateStatus.textContent = error.message; }
});
$('#template-clear').addEventListener('click', async () => {
  $('#template-filter').reset(); templateFilters = {};
  try { await loadTemplates(); } catch (error) { templateStatus.textContent = error.message; }
});
$('#more-templates').addEventListener('click', async () => {
  const button = $('#more-templates'); button.disabled = true;
  try { await loadTemplates(true); } catch (error) { templateStatus.textContent = error.message; }
  finally { button.disabled = false; }
});
$('#preview-template').addEventListener('click', async () => {
  let token;
  try { ({ token } = await api('/api/template-preview')); }
  catch (error) { templateStatus.textContent = error.message; return; }
  const frame = document.createElement('iframe');
  frame.id = 'template-preview-frame'; frame.name = 'template-preview-frame'; frame.title = 'Template HTML preview'; frame.setAttribute('sandbox', '');
  $('#template-preview').hidden = false; $('#template-preview-content').replaceChildren(frame);
  const form = document.createElement('form'); form.method = 'post'; form.action = '/api/template-preview'; form.target = frame.name;
  const input = document.createElement('input'); input.type = 'hidden'; input.name = 'html'; input.value = $('#template-html').value;
  const csrf = document.createElement('input'); csrf.type = 'hidden'; csrf.name = 'token'; csrf.value = token;
  form.append(input, csrf);
  const samples = $('#template-preview-values').value.trim();
  if (samples) {
    for (const [name, value] of [['declarations', $('#template-variables').value.trim() || '[]'], ['variables', samples]]) {
      const field = document.createElement('input'); field.type = 'hidden'; field.name = name; field.value = value; form.append(field);
    }
  }
 document.body.append(form); form.submit(); form.remove();
});
$('#close-template-preview').addEventListener('click', () => {
  $('#template-preview').hidden = true; $('#template-preview-content').replaceChildren(); $('#preview-template').focus();
});
$('#new-template').addEventListener('click', () => { if (confirmDiscard()) { openTemplate(); templateStatus.textContent = ''; } });
$('#cancel-template').addEventListener('click', () => { if (confirmDiscard()) { templateForm.hidden = true; templateDirty = false; $('#new-template').focus(); } });
templateForm.addEventListener('input', event => { if (event.target.id !== 'template-preview-values') { templateDirty = true; updatePublishButton(); } });
templateForm.addEventListener('submit', async event => {
  event.preventDefault();
  const controls = [...templateForm.querySelectorAll('input, textarea, button')]; controls.forEach(control => { control.disabled = true; });
  try {
    let variables = [];
    try { variables = $('#template-variables').value.trim() ? JSON.parse($('#template-variables').value) : []; }
    catch { throw new Error('Variables must be valid JSON.'); }
    if (!Array.isArray(variables)) throw new Error('Variables must be a JSON array.');
    const body = { name: $('#template-name').value, alias: $('#template-alias').value.trim() || null, from: $('#template-from').value, subject: $('#template-subject').value, html: $('#template-html').value, text: $('#template-text').value, variables };
    const saved = await api(templateId ? `/api/templates/${encodeURIComponent(templateId)}` : '/api/templates', { method: templateId ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    templateId = saved.id; templateDirty = false; $('#delete-template').hidden = false; updatePublishButton();
    await loadTemplates(); templateStatus.textContent = 'Draft saved. Publish it to use it for sending.';
  } catch (error) { templateStatus.textContent = error.message; }
  finally { controls.forEach(control => { control.disabled = false; }); updatePublishButton(); }
});
$('#publish-template').addEventListener('click', async () => {
  if (!templateId || templateDirty || !window.confirm('Publish this saved draft? Future emails will use it.')) return;
  const button = $('#publish-template'); button.disabled = true;
  try { await api(`/api/templates/${encodeURIComponent(templateId)}/publish`, { method: 'POST', body: '{}' }); await loadTemplates(); templateStatus.textContent = 'Template published.'; }
  catch (error) { templateStatus.textContent = error.message; }
  finally { updatePublishButton(); }
});
$('#delete-template').addEventListener('click', async () => {
  if (!templateId || !window.confirm('Delete this template and its published version permanently?')) return;
  try { await api(`/api/templates/${encodeURIComponent(templateId)}`, { method: 'DELETE' }); templateId = null; templateDirty = false; templateForm.hidden = true; await loadTemplates(); templateStatus.textContent = 'Template deleted.'; $('#new-template').focus(); }
  catch (error) { templateStatus.textContent = error.message; }
});
$('#signup-form').addEventListener('submit', async (event) => {
  event.preventDefault(); announce('Creating account…');
  try {
    await api('/api/auth/sign-up/email', { method: 'POST', body: JSON.stringify({ name: $('#signup-name').value, email: $('#signup-email').value, password: $('#signup-password').value, callbackURL: '/dashboard' }) });
    $('#signup-password').value = ''; showView('login');
    announce('If registration is available, check your email for a verification link.');
  } catch (error) { announce(error.message); }
});
$('#verify-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.currentTarget.querySelector('button[type="submit"]'); button.disabled = true;
  announce('Requesting verification link…');
  let message = 'If verification is needed and email delivery is configured, check your inbox for a link.';
  try { await api('/api/auth/send-verification-email', { method: 'POST', body: JSON.stringify({ email: $('#verify-email').value.trim(), callbackURL: '/dashboard' }) }); }
  catch (error) {
    // A network failure is independent of whether the account exists.
    if (error instanceof TypeError) message = 'Could not reach Cloudmail. Check your connection and try again.';
  }
  finally { button.disabled = false; announce(message); }
});
$('#forgot-form').addEventListener('submit', async (event) => {
  event.preventDefault(); announce('Requesting recovery link…');
  try {
    await api('/api/auth/request-password-reset', { method: 'POST', body: JSON.stringify({ email: $('#forgot-email').value, redirectTo: `${location.origin}/dashboard` }) });
    announce('If an account exists, check your email for a recovery link.');
  } catch (error) { announce(error.message); }
});
$('#reset-form').addEventListener('submit', async (event) => {
  event.preventDefault(); announce('Saving password…');
  try {
    await api('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: resetToken, newPassword: $('#new-password').value }) });
    resetToken = null; $('#new-password').value = ''; showView('login'); announce('Password updated. You can now sign in.');
  } catch (error) { announce(error.message); }
});
$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault(); announce('Signing in…');
  try {
    await api('/api/auth/sign-in/email', { method: 'POST', body: JSON.stringify({ email: $('#email').value, password: $('#password').value }) });
    $('#password').value = '';
    const session = await api('/api/auth/get-session'); setSignedIn(session);
    announce('Signed in.');
  } catch (error) { announce(error.message); }
});
$('#sign-out').addEventListener('click', async () => {
  if ((templateDirty || composeDirty) && !window.confirm('Sign out and discard unsaved changes?')) return;
  try { await api('/api/auth/sign-out', { method: 'POST', body: '{}' }); setSignedIn(null); announce('Signed out.'); }
  catch (error) { announce(error.message); }
});
$('#key-form').addEventListener('submit', async (event) => {
  event.preventDefault(); announce('Creating key…');
  try {
    const key = await api('/api/keys', { method: 'POST', body: JSON.stringify({ name: $('#key-name').value, permission: $('#key-permission').value, sending_domain: $('#key-domain').value.trim() || null }) });
    $('#key-value').textContent = key.token; $('#new-key').hidden = false; $('#key-name').value = ''; $('#key-domain').value = '';
    await loadKeys(); announce('Key created. Copy it now.');
  } catch (error) { announce(error.message); }
});
$('#copy-key').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#key-value').textContent); announce('Key copied.'); }
  catch { announce('Could not copy. Select and copy the key manually.'); }
});
async function showSetup() {
  const setup = await api('/api/setup');
  const missing = [];
  if (!setup.authentication_configured) missing.push('Configure the authentication URL and secret.');
  else if (!setup.authentication_origin_matches) missing.push('Open the dashboard at the configured authentication URL, or update BETTER_AUTH_URL to match this address.');
  if (!setup.sender_configured) missing.push('Configure the authentication sender address.');
  if (!setup.administrator_configured) missing.push('Configure the administrator email address.');
  if (!setup.registration_enabled) missing.push('Enable registration when your sender is ready.');
  if (missing.length) {
    const box = $('#setup-hint');
    const title = document.createElement('strong'); title.textContent = 'Installation setup'; box.append(title);
    for (const instruction of missing) { const p = document.createElement('p'); p.textContent = instruction; box.append(p); }
    box.hidden = false;
  }
}
(async () => {
  try { await showSetup(); } catch { announce('Could not load installation setup status.'); }
  try { if (resetToken) { showView('reset'); return; } if (resetError) { showView('forgot'); announce('This recovery link is invalid or has expired. Request a new one.'); return; } const session = await api('/api/auth/get-session'); setSignedIn(session); }
  catch (error) { announce(error.message); }
})();
