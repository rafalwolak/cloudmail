const $ = (selector) => document.querySelector(selector);
const status = $('#status');
const announce = (message) => { status.textContent = message; };
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...options.headers } });
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(body?.message || 'Request failed. Please try again.');
  return body;
}
const views = ['login', 'signup', 'forgot', 'reset', 'dashboard'];
function showView(view) {
  for (const name of views) $(`#${name}-view`).hidden = name !== view;
}
let resetToken = new URLSearchParams(location.search).get('token');
const resetError = new URLSearchParams(location.search).get('error');
if (resetToken || resetError) history.replaceState(null, '', location.pathname);
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { showView(button.dataset.view); announce(''); }));
function setSignedIn(session) {
  showView(session ? 'dashboard' : 'login');
  $('#new-key').hidden = true;
  $('#key-value').textContent = '';
  if (session) $('#account').textContent = `Signed in as ${session.user.email}`;
  else { $('#history-list').replaceChildren(); $('#history-status').textContent = ''; $('#load-more').hidden = true; $('#template-list').replaceChildren(); $('#template-form').reset(); $('#template-form').hidden = true; templateId = null; templateDirty = false; }
}
async function loadKeys() {
  const { data } = await api('/api/keys');
  const list = $('#key-list');
  list.replaceChildren();
  $('#empty-keys').hidden = data.length > 0;
  for (const key of data) {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = key.name;
    const revoke = document.createElement('button');
    revoke.type = 'button'; revoke.className = 'text-button'; revoke.textContent = 'Revoke';
    revoke.setAttribute('aria-label', `Revoke ${key.name}`);
    revoke.addEventListener('click', async () => {
      if (!window.confirm(`Revoke “${key.name}”? Applications using it will stop working.`)) return;
      try { await api(`/api/keys/${encodeURIComponent(key.id)}`, { method: 'DELETE' }); $('#new-key').hidden = true; $('#key-value').textContent = ''; await loadKeys(); announce('Key revoked.'); }
      catch (error) { announce(error.message); }
    });
    item.append(name, revoke); list.append(item);
  }
}
let historyCursor = null;
async function loadHistory(reset = false) {
  const message = $('#history-status');
  message.textContent = 'Loading email attempts…';
  const params = new URLSearchParams({ limit: '20' });
  if (!reset && historyCursor) params.set('after', historyCursor);
  const result = await api(`/api/history?${params}`);
  const list = $('#history-list');
  if (reset) list.replaceChildren();
  for (const email of result.data) {
    const item = document.createElement('li');
    const subject = document.createElement('strong'); subject.textContent = email.subject;
    const detail = document.createElement('span'); detail.textContent = `${email.to.join(', ')} · ${email.status} · ${new Date(email.created_at).toLocaleString()}`;
    const details = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = 'Delivery events';
    const content = document.createElement('div'); content.className = 'delivery-events';
    details.append(summary, content);
    details.addEventListener('toggle', async () => {
      if (!details.open || details.dataset.loaded === 'true' || details.dataset.loading === 'true') return;
      details.dataset.loading = 'true'; content.textContent = 'Loading delivery events…';
      try {
        const result = await api(`/api/history/${encodeURIComponent(email.id)}`);
        content.replaceChildren();
        if (result.delivery_events.length === 0) {
          const empty = document.createElement('p'); empty.textContent = 'No delivery events recorded. A Cloudflare event subscription is required.'; content.append(empty);
        } else {
          const events = document.createElement('ul');
          for (const event of result.delivery_events) {
            const row = document.createElement('li');
            row.textContent = `${event.recipient} · ${event.type} · ${new Date(event.occurred_at).toLocaleString()}`;
            events.append(row);
          }
          content.append(events);
          if (result.delivery_events_has_more) { const note = document.createElement('p'); note.textContent = 'Only the first 100 events are shown.'; content.append(note); }
        }
        details.dataset.loaded = 'true';
      } catch (error) { content.textContent = `${error.message} Close and reopen to retry.`; }
      finally { delete details.dataset.loading; }
    });
    item.append(subject, detail, details); list.append(item);
  }
  historyCursor = result.data.at(-1)?.id || null;
  $('#empty-history').hidden = list.children.length > 0;
  $('#load-more').hidden = !result.has_more;
  message.textContent = '';
}
$('#load-more').addEventListener('click', async () => {
  const button = $('#load-more'); button.disabled = true;
  try { await loadHistory(); } catch (error) { $('#history-status').textContent = error.message; }
  finally { button.disabled = false; }
});
let templateId = null;
let templateDirty = false;
const templateForm = $('#template-form');
const templateStatus = $('#template-status');
function confirmDiscard() { return !templateDirty || window.confirm('Discard unsaved template changes?'); }
function updatePublishButton() { $('#publish-template').disabled = !templateId || templateDirty; }
function openTemplate(template = null) {
  templateId = template?.id || null;
  templateDirty = false;
  templateForm.reset();
  $('#template-name').value = template?.name || '';
  $('#template-from').value = template?.from || '';
  $('#template-subject').value = template?.subject || '';
  $('#template-html').value = template?.html || '';
  $('#template-text').value = template?.text || '';
  $('#template-variables').value = template?.variables?.length ? JSON.stringify(template.variables, null, 2) : '';
  $('#template-editor-title').textContent = template ? `Edit ${template.name}` : 'New template';
  $('#delete-template').hidden = !template;
  updatePublishButton(); templateForm.hidden = false; $('#template-name').focus();
}
async function loadTemplates() {
  const result = await api('/api/templates');
  const list = $('#template-list'); list.replaceChildren();
  $('#empty-templates').hidden = result.data.length > 0;
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
    item.append(name, edit); list.append(item);
  }
  if (result.has_more) templateStatus.textContent = 'Only the first 100 templates are shown.';
}
$('#new-template').addEventListener('click', () => { if (confirmDiscard()) { openTemplate(); templateStatus.textContent = ''; } });
$('#cancel-template').addEventListener('click', () => { if (confirmDiscard()) { templateForm.hidden = true; templateDirty = false; $('#new-template').focus(); } });
templateForm.addEventListener('input', () => { templateDirty = true; updatePublishButton(); });
templateForm.addEventListener('submit', async event => {
  event.preventDefault();
  const controls = [...templateForm.querySelectorAll('input, textarea, button')]; controls.forEach(control => { control.disabled = true; });
  try {
    let variables = [];
    try { variables = $('#template-variables').value.trim() ? JSON.parse($('#template-variables').value) : []; }
    catch { throw new Error('Variables must be valid JSON.'); }
    if (!Array.isArray(variables)) throw new Error('Variables must be a JSON array.');
    const body = { name: $('#template-name').value, from: $('#template-from').value, subject: $('#template-subject').value, html: $('#template-html').value, text: $('#template-text').value, variables };
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
    await loadKeys(); await loadHistory(true); await loadTemplates(); announce('Signed in.');
  } catch (error) { announce(error.message); }
});
$('#sign-out').addEventListener('click', async () => {
  try { await api('/api/auth/sign-out', { method: 'POST', body: '{}' }); setSignedIn(null); announce('Signed out.'); }
  catch (error) { announce(error.message); }
});
$('#key-form').addEventListener('submit', async (event) => {
  event.preventDefault(); announce('Creating key…');
  try {
    const key = await api('/api/keys', { method: 'POST', body: JSON.stringify({ name: $('#key-name').value }) });
    $('#key-value').textContent = key.token; $('#new-key').hidden = false; $('#key-name').value = '';
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
  try { if (resetToken) { showView('reset'); return; } if (resetError) { showView('forgot'); announce('This recovery link is invalid or has expired. Request a new one.'); return; } const session = await api('/api/auth/get-session'); setSignedIn(session); if (session) { await loadKeys(); await loadHistory(true); await loadTemplates(); } }
  catch (error) { announce(error.message); }
})();
