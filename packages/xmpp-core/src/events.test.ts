import { describe, expect, it } from 'vitest';
import { xml } from '@xmpp/client';
import { parseDirectInvitation, parseRosterPush } from './stanza';
import { CONFERENCE_NAMESPACE, ROSTER_NAMESPACE } from './namespaces';

const domain = 'zilar.localhost';
const mucDomain = 'rooms.zilar.localhost';
const roomJid = `project@${mucDomain}`;
const me = `bob@${domain}`;

function invitation(
  attrs: { from?: string; room?: string; reason?: string },
  children: ReturnType<typeof xml>[] = [],
): ReturnType<typeof xml> {
  const stanzaAttrs: Record<string, string> = {};
  if (attrs.from !== undefined) stanzaAttrs['from'] = attrs.from;
  if (attrs.room !== undefined) {
    const conferenceAttrs: Record<string, string> = {
      xmlns: CONFERENCE_NAMESPACE,
      jid: attrs.room,
    };
    if (attrs.reason !== undefined) conferenceAttrs['reason'] = attrs.reason;
    return xml('message', stanzaAttrs, xml('x', conferenceAttrs), ...children);
  }
  return xml('message', stanzaAttrs, ...children);
}

function rosterPush(attrs: {
  from?: string;
  id?: string;
  type?: string;
  items?: Array<Record<string, string>>;
}): ReturnType<typeof xml> {
  const stanzaAttrs: Record<string, string> = { type: attrs.type ?? 'set' };
  if (attrs.from !== undefined) stanzaAttrs['from'] = attrs.from;
  if (attrs.id !== undefined) stanzaAttrs['id'] = attrs.id;
  const items = (attrs.items ?? []).map((item) => xml('item', item));
  return xml('iq', stanzaAttrs, xml('query', { xmlns: ROSTER_NAMESPACE }, ...items));
}

describe('parseDirectInvitation', () => {
  it('accepts an invitation from our own domain and keeps the reason', () => {
    const event = parseDirectInvitation(
      invitation({ from: `alice@${domain}`, room: roomJid, reason: 'Join us' }),
      domain,
      mucDomain,
    );
    expect(event).toEqual({
      roomJid,
      fromJid: `alice@${domain}`,
      reason: 'Join us',
    });
  });

  it('accepts a sender on the MUC domain and drops an empty reason', () => {
    expect(
      parseDirectInvitation(
        invitation({ from: `${roomJid}/alice`, room: roomJid, reason: '' }),
        domain,
        mucDomain,
      ),
    ).toEqual({ roomJid, fromJid: roomJid });
  });

  it('ignores a room on another MUC domain', () => {
    expect(
      parseDirectInvitation(
        invitation({ from: `alice@${domain}`, room: 'project@rooms.evil.example' }),
        domain,
        mucDomain,
      ),
    ).toBeUndefined();
  });

  it('ignores a spoofed sender from another domain', () => {
    expect(
      parseDirectInvitation(
        invitation({ from: 'mallory@evil.example', room: roomJid }),
        domain,
        mucDomain,
      ),
    ).toBeUndefined();
  });

  it('ignores an invitation without a sender', () => {
    expect(parseDirectInvitation(invitation({ room: roomJid }), domain, mucDomain)).toBeUndefined();
  });

  it('ignores a message without a conference element or a room JID', () => {
    expect(
      parseDirectInvitation(xml('message', { from: `alice@${domain}` }), domain, mucDomain),
    ).toBeUndefined();
    expect(
      parseDirectInvitation(
        xml('message', { from: `alice@${domain}` }, xml('x', { xmlns: CONFERENCE_NAMESPACE })),
        domain,
        mucDomain,
      ),
    ).toBeUndefined();
  });
});

describe('parseRosterPush', () => {
  it('trusts a push with no sender and parses its items', () => {
    const push = parseRosterPush(
      rosterPush({
        id: 'p1',
        items: [{ jid: `alice@${domain}`, subscription: 'both', name: 'Alice' }],
      }),
      domain,
      me,
    );
    expect(push).toEqual({
      id: 'p1',
      trusted: true,
      items: [{ jid: `alice@${domain}`, subscription: 'both', name: 'Alice' }],
    });
  });

  it('trusts a push from our own bare JID or domain', () => {
    expect(parseRosterPush(rosterPush({ from: me, id: 'p1' }), domain, me)?.trusted).toBe(true);
    expect(parseRosterPush(rosterPush({ from: domain, id: 'p1' }), domain, me)?.trusted).toBe(true);
  });

  it('defaults an unknown subscription to none and drops an empty name', () => {
    const push = parseRosterPush(
      rosterPush({
        id: 'p1',
        items: [{ jid: `alice@${domain}`, subscription: 'bogus', name: '' }],
      }),
      domain,
      me,
    );
    expect(push?.items).toEqual([{ jid: `alice@${domain}`, subscription: 'none' }]);
  });

  it('marks a push from another user on our domain as untrusted', () => {
    const push = parseRosterPush(
      rosterPush({ from: `mallory@${domain}`, id: 'p1', items: [{ jid: `alice@${domain}` }] }),
      domain,
      me,
    );
    expect(push?.trusted).toBe(false);
    expect(push?.from).toBe(`mallory@${domain}`);
  });

  it('marks a push from another domain as untrusted', () => {
    expect(
      parseRosterPush(rosterPush({ from: 'mallory@evil.example', id: 'p1' }), domain, me)?.trusted,
    ).toBe(false);
  });

  it('ignores non-set IQs, other queries and pushes without an id', () => {
    expect(parseRosterPush(rosterPush({ id: 'p1', type: 'result' }), domain, me)).toBeUndefined();
    expect(
      parseRosterPush(
        xml('iq', { type: 'set', id: 'p1' }, xml('query', { xmlns: 'x' })),
        domain,
        me,
      ),
    ).toBeUndefined();
    expect(parseRosterPush(rosterPush({ items: [] }), domain, me)).toBeUndefined();
  });
});
