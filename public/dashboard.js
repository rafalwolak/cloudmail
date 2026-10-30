const $ = (selector) => document.querySelector(selector);
const status = $('#status');
const announce = (message) => { status.textContent = message; };
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...options.headers } });
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(body?.message || 'Request failed. Please try again.');
  return body;
}
function setSignedIn(session) {
  $('#login-view').hidden = !!session;
  $('#dashboard-view').hidden = !session;
  $('#new-key').hidden = true;
  $('#key-value').textContent = '';
  if (session) $('#account').textContent = `Signed in as ${session.user.email}`;
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
$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault(); announce('Signing in…');
  try {
    await api('/api/auth/sign-in/email', { method: 'POST', body: JSON.stringify({ email: $('#email').value, password: $('#password').value }) });
    $('#password').value = '';
    const session = await api('/api/auth/get-session'); setSignedIn(session);
    await loadKeys(); announce('Signed in.');
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
  try { const session = await api('/api/auth/get-session'); setSignedIn(session); if (session) await loadKeys(); }
  catch (error) { announce(error.message); }
})();
