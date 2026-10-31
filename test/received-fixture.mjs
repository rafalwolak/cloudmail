import { localTestOrigin } from './local-auth-mail.mjs';

export async function injectReceivedFixture(base) {
  base = localTestOrigin(base);
  const marker = crypto.randomUUID();
  const raw = ['From: Customer <customer@example.com>', 'To: visible@example.com', 'Reply-To: reply@example.com', `Message-ID: <${marker}@example.com>`, `Subject: Contract ${marker}`, 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="contract-boundary"', '', '--contract-boundary', 'Content-Type: text/plain; charset=utf-8', '', 'Synthetic inbound content', '--contract-boundary', 'Content-Type: text/plain', 'Content-Disposition: attachment; filename="test.txt"', 'Content-Transfer-Encoding: base64', '', 'aGk=', '--contract-boundary--', ''].join('\r\n');
  const response = await fetch(`${base}/cdn-cgi/local/email?from=bounce@example.net&to=inbox@example.com`, { method: 'POST', headers: { 'content-type': 'message/rfc822' }, body: raw });
  if (response.status !== 200) throw new Error(`Local email injection failed (${response.status})`);
  return marker;
}
