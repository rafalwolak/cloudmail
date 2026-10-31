const mailbox = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const messageId = value => typeof value === 'string' && value.length <= 998 && /^[\x21-\x7e]+$/.test(value) && /^<[^<>@\s]+@[^<>@\s]+>$/.test(value);

export function replyDraft(received) {
  const source = received.reply_to?.length ? received.reply_to : [received.header_from];
  const to = [];
  if (!Array.isArray(source) || source.length > 50) throw new Error('Cannot prepare the reply address. Choose recipients manually.');
  for (const entry of source) {
    const members = Array.isArray(entry?.group) ? entry.group : [entry];
    if (members.length > 50) throw new Error('Cannot prepare the reply address. Choose recipients manually.');
    for (const member of members) {
      const address = member?.address;
      if (typeof address !== 'string' || address.length > 254 || !mailbox.test(address) || to.length >= 50) throw new Error('Cannot prepare the reply address. Choose recipients manually.');
      to.push(address);
    }
  }
  if (!to.length) throw new Error('Cannot prepare the reply address. Choose recipients manually.');
  const notes = [];
  const originalSubject = typeof received.subject === 'string' ? received.subject : '';
  const cleanSubject = originalSubject.slice(0, 2000).replace(/[\r\n]+/g, ' ').trim();
  let subject = /^re:/i.test(cleanSubject) ? cleanSubject : `Re: ${cleanSubject || '(No subject)'}`;
  if ([...subject].length > 998 || originalSubject.length > 2000) { subject = [...subject].slice(0, 998).join(''); notes.push('Subject was shortened.'); }
  const headers = {};
  if (messageId(received.message_id)) {
    headers['In-Reply-To'] = received.message_id;
    const raw = typeof received.references === 'string' ? received.references : '';
    let references = raw.length <= 8192 ? raw.trim().split(/\s+/).filter(Boolean) : [];
    if (raw.length > 8192 || references.some(value => !messageId(value))) { references = []; notes.push('Some original references were omitted.'); }
    references = [...new Set(references)].filter(value => value !== received.message_id);
    const chain = [received.message_id]; let bytes = received.message_id.length;
    for (let index = references.length - 1; index >= 0; index--) {
      if (bytes + references[index].length + 1 > 2048) { notes.push('Older references were omitted.'); break; }
      chain.unshift(references[index]); bytes += references[index].length + 1;
    }
    headers.References = chain.join(' ');
  } else notes.push('Threading is unavailable because the original Message-ID is missing or invalid.');
  return { to: [...new Set(to)], subject, headers, note: notes.join(' ') };
}
