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
  else { resetWebhookForm(); $('#webhook-list').replaceChildren(); $('#webhook-secret-value').textContent = ''; $('#webhook-secret').hidden = true; $('#webhook-status').textContent = ''; $('#inbox-list').replaceChildren(); $('#inbox-more').hidden = true; $('#inbox-status').textContent = ''; inboxCursor = null; $('#history-list').replaceChildren(); $('#history-status').textContent = ''; $('#load-more').hidden = true; $('#template-list').replaceChildren(); $('#more-templates').hidden = true; templateCursor = null; $('#template-form').reset(); $('#template-form').hidden = true; templateId = null; templateDirty = false; }
}
async function loadKeys() {
  const { data } = await api('/api/keys');
  const list = $('#key-list');
  list.replaceChildren();
  $('#empty-keys').hidden = data.length > 0;
  for (const key of data) {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = `${key.name} · ${key.permission === 'sending_access' ? 'Send only' : 'Full access'}${key.sending_domain ? ` · ${key.sending_domain}` : ''}`;
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
    item.append(subject, detail);
    if (email.status === 'scheduled' && email.scheduled_at) {
      const when = document.createElement('span');
      when.textContent = `Scheduled for ${new Date(email.scheduled_at).toLocaleString()} (your time zone)`;
      item.append(when);
      const form = document.createElement('form'); form.className = 'schedule-form';
      const label = document.createElement('label'); label.htmlFor = `schedule-${email.id}`; label.textContent = `New send time for ${email.subject}`;
      const input = document.createElement('input'); input.id = label.htmlFor; input.type = 'datetime-local'; input.required = true;
      const date = new Date(email.scheduled_at);
      input.value = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      const save = document.createElement('button'); save.type = 'submit'; save.className = 'secondary'; save.textContent = 'Reschedule';
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'text-button'; cancel.textContent = 'Cancel scheduled email';
      cancel.setAttribute('aria-label', `Cancel scheduled email ${email.subject}`);
      form.append(label, input, save, cancel); item.append(form);
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
    item.append(details); list.append(item);
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
let editingWebhookId = null;
function resetWebhookForm() { editingWebhookId = null; $('#webhook-form').reset(); $('#webhook-form-title').textContent = 'Create webhook'; $('#webhook-form button[type=submit]').textContent = 'Create webhook'; $('#cancel-webhook-edit').hidden = true; }
$('#cancel-webhook-edit').addEventListener('click', () => { resetWebhookForm(); $('#webhook-status').textContent = 'Edit canceled.'; });
async function loadWebhooks() {
  const result = await api('/api/webhooks'); const list = $('#webhook-list'); list.replaceChildren();
  $('#empty-webhooks').hidden = result.data.length > 0;
  for (const webhook of result.data) {
    const item = document.createElement('li'); const endpoint = document.createElement('strong'); endpoint.textContent = webhook.endpoint;
    const events = document.createElement('span'); events.textContent = webhook.events.join(', ');
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
              const row = document.createElement('li'); const label = document.createElement('span'); label.textContent = `${delivery.type} · ${delivery.state} · ${delivery.attempts} attempts${delivery.last_status ? ` · HTTP ${delivery.last_status}` : ''} · ${new Date(delivery.occurred_at).toLocaleString()}`;
              const replay = document.createElement('button'); replay.type = 'button'; replay.className = 'text-button'; replay.textContent = 'Replay'; replay.setAttribute('aria-label', `Replay ${delivery.type} delivery ${delivery.id}`);
              replay.addEventListener('click', async () => {
                if (!window.confirm('Queue another delivery of this event? The existing retry schedule will continue.')) return;
                replay.disabled = true;
                try { await api(`/api/webhooks/${encodeURIComponent(webhook.id)}/deliveries/${encodeURIComponent(delivery.id)}/replay`, { method: 'POST', body: '{}' }); $('#webhook-status').textContent = 'Replay queued. Close and reopen delivery attempts to refresh.'; details.dataset.loaded = ''; }
                catch (error) { $('#webhook-status').textContent = error.message; replay.disabled = false; }
              });
              row.append(label, replay); rows.append(row);
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
    item.append(endpoint, events, details, edit, rotate, remove); list.append(item);
  }
}
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
let inboxCursor = null;
async function loadInbox(reset = false) {
  const message = $('#inbox-status'); message.textContent = 'Loading received email…';
  const params = new URLSearchParams({ limit: '20' });
  if (!reset && inboxCursor) params.set('after', inboxCursor);
  const result = await api(`/api/inbox?${params}`); const list = $('#inbox-list');
  if (reset) list.replaceChildren();
  for (const email of result.data) {
    const item = document.createElement('li'); const title = document.createElement('strong'); title.textContent = email.subject || '(No subject)';
    const metadata = document.createElement('span'); metadata.textContent = `${email.sender} → ${email.recipient} · ${new Date(email.created_at).toLocaleString()}`;
    const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Read message';
    const content = document.createElement('div'); details.append(summary, content);
    details.addEventListener('toggle', async () => {
      if (!details.open || details.dataset.loaded || details.dataset.loading) return;
      details.dataset.loading = 'true'; content.textContent = 'Loading message…';
      try {
        const received = await api(`/api/inbox/${encodeURIComponent(email.id)}`); content.replaceChildren();
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
    item.append(title, metadata, details, remove); list.append(item);
  }
  inboxCursor = result.data.at(-1)?.id || null; $('#inbox-more').hidden = !result.has_more;
  $('#empty-inbox').hidden = list.children.length > 0; message.textContent = '';
}
$('#inbox-more').addEventListener('click', async () => {
  const button = $('#inbox-more'); button.disabled = true;
  try { await loadInbox(); } catch (error) { $('#inbox-status').textContent = error.message; }
  finally { button.disabled = false; }
});
let templateId = null;
let templateDirty = false;
let templateCursor = null;
const templateForm = $('#template-form');
const templateStatus = $('#template-status');
function confirmDiscard() { return !templateDirty || window.confirm('Discard unsaved template changes?'); }
function updatePublishButton() { $('#publish-template').disabled = !templateId || templateDirty; }
function openTemplate(template = null) {
  templateId = template?.id || null;
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
  const params = new URLSearchParams({ limit: '20' });
  if (append && templateCursor) params.set('after', templateCursor);
  const result = await api(`/api/templates?${params}`);
  const list = $('#template-list'); if (!append) list.replaceChildren();
  $('#empty-templates').hidden = list.children.length > 0 || result.data.length > 0;
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
$('#more-templates').addEventListener('click', async () => {
  const button = $('#more-templates'); button.disabled = true;
  try { await loadTemplates(true); } catch (error) { templateStatus.textContent = error.message; }
  finally { button.disabled = false; }
});
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
    await loadKeys(); await loadHistory(true); await loadTemplates(); await loadInbox(true); await loadWebhooks(); announce('Signed in.');
  } catch (error) { announce(error.message); }
});
$('#sign-out').addEventListener('click', async () => {
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
  try { if (resetToken) { showView('reset'); return; } if (resetError) { showView('forgot'); announce('This recovery link is invalid or has expired. Request a new one.'); return; } const session = await api('/api/auth/get-session'); setSignedIn(session); if (session) { await loadKeys(); await loadHistory(true); await loadTemplates(); await loadInbox(true); await loadWebhooks(); } }
  catch (error) { announce(error.message); }
})();
