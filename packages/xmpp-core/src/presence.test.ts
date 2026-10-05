import { describe, expect, it } from 'vitest';
import { xml } from '@xmpp/client';
import {
  decodeMessageStanza,
  occupantIdOf,
  parseContactPresence,
  parseMucPresence,
  resolveSender,
  type ParseContext,
} from './stanza';
import { MUC_USER_NAMESPACE, OCCUPANT_ID_NAMESPACE, STANZA_ID_NAMESPACE } from './namespaces';
import type { Occupant } from './types';

const roomJid = 'project@rooms.zilar.localhost';
const mucDomain = 'rooms.zilar.localhost';

function item(attrs: Record<string, string>): ReturnType<typeof xml> {
  return xml('x', { xmlns: MUC_USER_NAMESPACE }, xml('item', attrs));
}

function occupant(overrides: Partial<Occupant> & { jid: string; nick: string }): Occupant {
  return { available: true, ...overrides };
}

function rosterOf(...occupants: Occupant[]): Map<string, Occupant> {
  const roster = new Map<string, Occupant>();
  for (const entry of occupants) roster.set(entry.jid, entry);
  return roster;
}

describe('parseMucPresence', () => {
  it('parses a join with the real JID, occupant-id, affiliation and role', () => {
    const stanza = xml(
      'presence',
      { from: `${roomJid}/alice`, to: 'bob@zilar.localhost' },
      item({ affiliation: 'member', role: 'participant', jid: 'alice@zilar.localhost/phone' }),
      xml('occupant-id', { xmlns: OCCUPANT_ID_NAMESPACE, id: 'occ-alice' }),
    );

    expect(parseMucPresence(stanza, mucDomain)).toEqual({
      roomJid,
      occupantJid: `${roomJid}/alice`,
      nick: 'alice',
      available: true,
      realJid: 'alice@zilar.localhost',
      occupantId: 'occ-alice',
      affiliation: 'member',
      role: 'participant',
    });
  });

  it('parses a leave as unavailable', () => {
    const stanza = xml(
      'presence',
      { from: `${roomJid}/alice`, type: 'unavailable' },
      item({ affiliation: 'member', role: 'none' }),
    );
    const presence = parseMucPresence(stanza, mucDomain);
    expect(presence?.available).toBe(false);
    expect(presence?.nick).toBe('alice');
  });

  it('parses a nick change as a leave from the old nick and a join of the new one', () => {
    const leaving = xml(
      'presence',
      { from: `${roomJid}/old`, type: 'unavailable' },
      item({ nick: 'new', affiliation: 'member', role: 'none' }),
    );
    const arriving = xml(
      'presence',
      { from: `${roomJid}/new` },
      item({
        nick: 'new',
        affiliation: 'member',
        role: 'participant',
        jid: 'alice@zilar.localhost',
      }),
    );

    expect(parseMucPresence(leaving, mucDomain)).toMatchObject({
      occupantJid: `${roomJid}/old`,
      nick: 'old',
      available: false,
    });
    expect(parseMucPresence(arriving, mucDomain)).toMatchObject({
      occupantJid: `${roomJid}/new`,
      nick: 'new',
      available: true,
      realJid: 'alice@zilar.localhost',
    });
  });

  it('ignores presence from a non-room sender', () => {
    const stanza = xml(
      'presence',
      { from: 'alice@zilar.localhost/phone' },
      item({ jid: 'alice@zilar.localhost' }),
    );
    expect(parseMucPresence(stanza, mucDomain)).toBeUndefined();
  });

  it('ignores presence from another MUC domain', () => {
    const stanza = xml('presence', { from: 'project@rooms.evil.example/alice' });
    expect(parseMucPresence(stanza, mucDomain)).toBeUndefined();
  });

  it('ignores a room JID without a nick', () => {
    expect(parseMucPresence(xml('presence', { from: roomJid }), mucDomain)).toBeUndefined();
  });

  it('ignores presence types that are not join or leave', () => {
    expect(
      parseMucPresence(xml('presence', { from: `${roomJid}/alice`, type: 'subscribe' }), mucDomain),
    ).toBeUndefined();
    expect(
      parseMucPresence(
        xml(
          'presence',
          { from: `${roomJid}/alice`, type: 'error' },
          xml('error', {}, xml('forbidden')),
        ),
        mucDomain,
      ),
    ).toBeUndefined();
  });

  it('reads an occupant-id only from the occupant-id namespace', () => {
    expect(
      occupantIdOf(
        xml('message', {}, xml('occupant-id', { xmlns: OCCUPANT_ID_NAMESPACE, id: 'x' })),
      ),
    ).toBe('x');
    expect(occupantIdOf(xml('message', {}, xml('occupant-id', { id: 'x' })))).toBeUndefined();
  });
});

describe('parseContactPresence', () => {
  const domain = 'zilar.localhost';

  it('parses an available presence into a bare JID', () => {
    expect(
      parseContactPresence(xml('presence', { from: 'alice@zilar.localhost/phone' }), domain),
    ).toEqual({ jid: 'alice@zilar.localhost', available: true });
  });

  it('parses an unavailable presence', () => {
    expect(
      parseContactPresence(
        xml('presence', { from: 'alice@zilar.localhost/phone', type: 'unavailable' }),
        domain,
      ),
    ).toEqual({ jid: 'alice@zilar.localhost', available: false });
  });

  it('ignores another domain, a MUC domain, subscription requests and no sender', () => {
    expect(
      parseContactPresence(xml('presence', { from: 'alice@evil.example/phone' }), domain),
    ).toBeUndefined();
    expect(
      parseContactPresence(xml('presence', { from: `${roomJid}/alice` }), domain),
    ).toBeUndefined();
    expect(
      parseContactPresence(
        xml('presence', { from: 'alice@zilar.localhost', type: 'subscribe' }),
        domain,
      ),
    ).toBeUndefined();
    expect(parseContactPresence(xml('presence', {}), domain)).toBeUndefined();
  });
});

describe('resolveSender', () => {
  const alice = occupant({
    jid: `${roomJid}/alice`,
    nick: 'alice',
    realJid: 'alice@zilar.localhost',
    occupantId: 'occ-alice',
  });
  const roster = rosterOf(alice);

  it('prefers a real JID carried by the message itself', () => {
    expect(
      resolveSender({
        kind: 'groupchat',
        from: `${roomJid}/ghost`,
        itemJid: 'alice@zilar.localhost/phone',
        occupantId: 'occ-alice',
        me: 'bob@zilar.localhost',
        roster,
      }),
    ).toEqual({
      jid: 'alice@zilar.localhost',
      resolved: true,
      occupantId: 'occ-alice',
      outgoing: false,
    });
  });

  it('resolves through the occupant-id before the nick', () => {
    // The nick says carol, but the occupant-id belongs to alice in the roster.
    expect(
      resolveSender({
        kind: 'groupchat',
        from: `${roomJid}/carol`,
        occupantId: 'occ-alice',
        me: 'bob@zilar.localhost',
        roster,
      }),
    ).toMatchObject({ jid: 'alice@zilar.localhost', resolved: true });
  });

  it('resolves through the nick when there is no occupant-id', () => {
    expect(
      resolveSender({
        kind: 'groupchat',
        from: `${roomJid}/alice`,
        me: 'bob@zilar.localhost',
        roster,
      }),
    ).toMatchObject({ jid: 'alice@zilar.localhost', resolved: true });
  });

  it('stays unresolved when neither the occupant-id nor the nick is known', () => {
    expect(
      resolveSender({
        kind: 'groupchat',
        from: `${roomJid}/ghost`,
        occupantId: 'occ-ghost',
        roster,
      }),
    ).toEqual({
      jid: `${roomJid}/ghost`,
      resolved: false,
      occupantId: 'occ-ghost',
      outgoing: false,
    });
  });

  it('marks my own message outgoing by real JID or by nick', () => {
    expect(
      resolveSender({
        kind: 'groupchat',
        from: `${roomJid}/alice`,
        me: 'alice@zilar.localhost',
        roster,
      }),
    ).toMatchObject({ outgoing: true });
    expect(
      resolveSender({ kind: 'groupchat', from: `${roomJid}/alice`, myNick: 'alice', roster }),
    ).toMatchObject({ outgoing: true });
    expect(
      resolveSender({ kind: 'groupchat', from: `${roomJid}/ghost`, myNick: 'ghost' }),
    ).toMatchObject({
      resolved: false,
      outgoing: true,
    });
  });

  it('treats a DM sender as already resolved', () => {
    expect(
      resolveSender({
        kind: 'chat',
        from: 'alice@zilar.localhost/phone',
        me: 'bob@zilar.localhost',
      }),
    ).toEqual({
      jid: 'alice@zilar.localhost',
      resolved: true,
      outgoing: false,
    });
  });
});

describe('decodeMessageStanza with a room roster', () => {
  const roster = rosterOf(
    occupant({
      jid: `${roomJid}/alice`,
      nick: 'alice',
      realJid: 'alice@zilar.localhost',
      occupantId: 'occ-alice',
    }),
    occupant({
      jid: `${roomJid}/bob`,
      nick: 'bob',
      realJid: 'bob@zilar.localhost',
      occupantId: 'occ-bob',
    }),
  );

  const ctx: ParseContext = {
    me: 'bob@zilar.localhost',
    domain: 'zilar.localhost',
    mucDomain,
    now: () => new Date('2026-09-27T12:00:00.000Z'),
    rosterFor: (room) => (room === roomJid ? roster : undefined),
    myNickFor: (room) => (room === roomJid ? 'bob' : undefined),
  };

  it('resolves an ejabberd live message through its occupant-id', () => {
    const stanza = xml(
      'message',
      { from: `${roomJid}/alice`, type: 'groupchat', id: 'm-1' },
      xml('occupant-id', { xmlns: OCCUPANT_ID_NAMESPACE, id: 'occ-alice' }),
      xml('body', {}, 'hi all'),
    );
    const { message } = decodeMessageStanza(stanza, ctx);
    expect(message).toMatchObject({
      fromJid: 'alice@zilar.localhost',
      fromResolved: true,
      occupantId: 'occ-alice',
      fromNick: 'alice',
      outgoing: false,
    });
  });

  it('resolves a MAM-archived message through the nick', () => {
    const stanza = xml(
      'message',
      { from: roomJid, to: 'bob@zilar.localhost/laptop' },
      xml(
        'result',
        { xmlns: 'urn:xmpp:mam:2', queryid: 'q', id: 'archive-1' },
        xml(
          'forwarded',
          { xmlns: 'urn:xmpp:forward:0' },
          xml(
            'message',
            { from: `${roomJid}/alice`, type: 'groupchat', id: 'm-2' },
            xml('stanza-id', { xmlns: STANZA_ID_NAMESPACE, by: roomJid, id: 'sid-2' }),
            xml('body', {}, 'archived'),
          ),
        ),
      ),
    );
    const { message } = decodeMessageStanza(stanza, ctx);
    expect(message).toMatchObject({
      fromJid: 'alice@zilar.localhost',
      fromResolved: true,
      fromNick: 'alice',
      outgoing: false,
    });
  });

  it('keeps the occupant JID and fromResolved=false when nothing resolves', () => {
    const stanza = xml(
      'message',
      { from: `${roomJid}/ghost`, type: 'groupchat', id: 'm-3' },
      xml('body', {}, 'who am I'),
    );
    const { message } = decodeMessageStanza(stanza, ctx);
    expect(message).toMatchObject({
      fromJid: `${roomJid}/ghost`,
      fromResolved: false,
      fromNick: 'ghost',
      outgoing: false,
    });
  });

  it('marks my own reflection outgoing via my nick even without a roster match', () => {
    const stanza = xml(
      'message',
      { from: `${roomJid}/bob`, type: 'groupchat', id: 'm-4' },
      xml('body', {}, 'mine'),
    );
    expect(decodeMessageStanza(stanza, ctx).message).toMatchObject({
      fromJid: 'bob@zilar.localhost',
      fromResolved: true,
      outgoing: true,
    });
  });
});
