import { captureLocalAuthLink, localTestOrigin } from '../test/local-auth-mail.mjs';

const base = localTestOrigin(process.env.TEST_BASE_URL || 'http://127.0.0.1:8787');
const email = process.env.TEST_DASHBOARD_ADMIN;
const password = process.env.TEST_DASHBOARD_PASSWORD;
if (!email || !password) throw new Error('Set the synthetic administrator credentials before preparing the fixture');
const setup = await (await fetch(`${base}/api/setup`)).json();
if (!setup.registration_enabled || !setup.sender_configured || !setup.administrator_configured) throw new Error('Local administrator fixture requires registration, sender and administrator configuration');
const headers = { origin: base, 'content-type': 'application/json' };
const verification = await captureLocalAuthLink(() => fetch(`${base}/api/auth/sign-up/email`, {
  method: 'POST', headers, body: JSON.stringify({ name: 'Local test administrator', email, password }),
}), { base, pathname: '/api/auth/verify-email', email });
const verified = await fetch(verification, { redirect: 'manual' });
if (![200, 302].includes(verified.status)) throw new Error('Local administrator verification failed');
const login = await fetch(`${base}/api/auth/sign-in/email`, { method: 'POST', headers, body: JSON.stringify({ email, password }) });
if (!login.ok) throw new Error('Local administrator sign-in failed');
const cookie = login.headers.get('set-cookie')?.split(';')[0];
if (!cookie || (await fetch(`${base}/api/keys`, { headers: { cookie } })).status !== 200) throw new Error('Local fixture does not have verified administrator access');
console.log('Local verified administrator fixture ready.');
