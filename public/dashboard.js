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
  else { $('#history-list').replaceChildren(); $('#history-status').textContent = ''; $('#load-more').hidden = true; }
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
    item.append(subject, detail); list.append(item);
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
    await loadKeys(); await loadHistory(true); announce('Signed in.');
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
(async () => {
  try { if (resetToken) { showView('reset'); return; } if (resetError) { showView('forgot'); announce('This recovery link is invalid or has expired. Request a new one.'); return; } const session = await api('/api/auth/get-session'); setSignedIn(session); if (session) { await loadKeys(); await loadHistory(true); } }
  catch (error) { announce(error.message); }
})();
