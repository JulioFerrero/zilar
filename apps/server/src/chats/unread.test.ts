// The chat-list unread count and preview (T-1272): an album's photos count
// once and preview as "{count} photos". `unreadForChats` needs a database and
// an archive pool, so this tests the extracted pure counting step
// (`summarizeUnread`) the loop runs over one batch read.

import { describe, expect, it } from 'vitest';
import type { SearchOwner } from '../search/service';
import { summarizeUnread } from './unread';

const PEER = 'ana@zilar.test';
const OWN_LOCALPART = 'me';
const OWN_JID = 'me@zilar.test';
const DOMAIN = 'zilar.test';
const CHAT_JID = PEER;

type UnreadRows = Parameters<typeof summarizeUnread>[0];
type ChatThresholds = Parameters<typeof summarizeUnread>[1];

const ALLOWED: SearchOwner = {
  ownLocalpart: OWN_LOCALPART,
  dmPeers: [PEER],
  rooms: [],
  peerNames: new Map([[PEER, 'Ana']]),
};

const CHATS: ChatThresholds = [{ jid: CHAT_JID, scope: { kind: 'dm', peer: PEER }, after: '0' }];

function dmRow(originId: string, xml: string, text: string | null = null): UnreadRows[number] {
  return {
    chatJid: CHAT_JID,
    barePeer: PEER,
    kind: 'chat',
    nick: '',
    originId,
    timestamp: BigInt(Date.now()) * 1000n,
    text,
    xml,
  };
}

function albumXml(index: number, id = 'alb-1'): string {
  return `<message type="chat" from="${PEER}/phone"><album xmlns="urn:zilar:album:0" id="${id}" index="${index}" count="3"/></message>`;
}

function plainXml(): string {
  return `<message type="chat" from="${PEER}/phone"><body>hello</body></message>`;
}

describe('summarizeUnread', () => {
  it('counts a same-album run once and previews the photo count when newest', () => {
    const page: UnreadRows = [
      dmRow('p-2', albumXml(2)),
      dmRow('p-1', albumXml(1)),
      dmRow('p-0', albumXml(0)),
      dmRow('plain', plainXml(), 'hello'),
    ];

    const answer = summarizeUnread(page, CHATS, ALLOWED, OWN_LOCALPART, OWN_JID, DOMAIN);

    expect(answer[CHAT_JID]?.unread).toBe(2);
    expect(answer[CHAT_JID]?.lastMessage?.text).toBe('3 photos');
    expect(answer[CHAT_JID]?.lastMessage?.id).toBe('p-2');
  });

  it('keeps a plain newest row as the preview', () => {
    const page: UnreadRows = [dmRow('plain', plainXml(), 'hello'), dmRow('p-0', albumXml(0))];

    const answer = summarizeUnread(page, CHATS, ALLOWED, OWN_LOCALPART, OWN_JID, DOMAIN);

    expect(answer[CHAT_JID]?.unread).toBe(2);
    expect(answer[CHAT_JID]?.lastMessage?.text).toBe('hello');
  });

  it('counts two different albums separately', () => {
    const page: UnreadRows = [
      dmRow('b-2', albumXml(2, 'alb-b')),
      dmRow('b-1', albumXml(1, 'alb-b')),
      dmRow('a-0', albumXml(0, 'alb-a')),
    ];

    const answer = summarizeUnread(page, CHATS, ALLOWED, OWN_LOCALPART, OWN_JID, DOMAIN);

    expect(answer[CHAT_JID]?.unread).toBe(2);
  });
});
