import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPublicDns } from '../src/dns-check.ts';

const record = (type, content, priority) => ({ type, name: 'mail.example.com', content, ...(priority === undefined ? {} : { priority }) });
const resolver = (body) => async (url, options) => {
  assert.equal(url.hostname, 'cloudflare-dns.com');
  assert.equal(options.headers.accept, 'application/dns-json');
  return Response.json(body);
};
const answer = (type, data) => ({ Status: 0, Answer: [{ name: 'mail.example.com.', type, data }] });

test('compares split TXT and DNS names, including MX priority', async () => {
  assert.equal((await checkPublicDns([record('TXT', 'v=spf1 include:example.com')], resolver(answer(16, '"v=spf1 " "include:example.com"'))))[0].status, 'match');
  assert.equal((await checkPublicDns([record('CNAME', 'TARGET.example.com')], resolver(answer(5, 'target.example.com.'))))[0].status, 'match');
  assert.equal((await checkPublicDns([record('MX', 'mx.example.com', 10)], resolver(answer(15, '20 mx.example.com.'))))[0].status, 'different');
});

test('distinguishes missing from unavailable and unsupported records', async () => {
  assert.equal((await checkPublicDns([record('TXT', 'x')], resolver({ Status: 3 })))[0].status, 'missing');
  assert.equal((await checkPublicDns([record('TXT', 'x')], resolver({ Status: 2 })))[0].status, 'unknown');
  assert.equal((await checkPublicDns([record('AAAA', '::1')], () => { throw Error('must not query'); }))[0].status, 'unknown');
  assert.equal((await checkPublicDns([record('TXT', 'x')], async () => { throw Error('offline'); }))[0].status, 'unknown');
  assert.equal((await checkPublicDns([record('TXT', 'x')], resolver({ Status: 0, TC: true })))[0].status, 'unknown');
});
