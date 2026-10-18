// The chat-list unread count and preview (T-1272): an album's photos count
// once and preview as "{count} photos". `unreadForChats` needs a database and
// an archive pool, so this tests the extracted pure counting step
// (`summarizeUnread`) the loop runs over one batch read.

import { describe, expect, it } from 'vitest';
import type { SearchOwner } from '../search/service';
import { newestUnskippedRow } from './unread';
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

const ROOM = `room@muc.${DOMAIN}`;
const ROOM_CHATS: ChatThresholds = [{ jid: ROOM, scope: { kind: 'room', room: ROOM }, after: '0' }];

function roomRow(originId: string, nick: string, barePeer: string): UnreadRows[number] {
  return {
    chatJid: ROOM,
    barePeer,
    kind: 'groupchat',
    nick,
    originId,
    timestamp: BigInt(Date.now()) * 1000n,
    text: 'hello',
    xml: `<message type="groupchat" from="${ROOM}/someone"><body>hello</body></message>`,
  };
}

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

function progressXml(): string {
  return `<message type="chat" from="ai-bot@zilar.test/desk"><body>Searching</body><agent xmlns="urn:zilar:agent:0">{"v":0,"type":"progress","data":{"ai":"ai-bot@zilar.test","stage":"Searching"}}</agent></message>`;
}

function correctionXml(target: string): string {
  return `<message type="chat" from="ai-bot@zilar.test/desk"><body>Working</body><replace xmlns="urn:xmpp:message-correct:0" id="${target}"/></message>`;
}

function retractionXml(target: string): string {
  return `<message type="chat" from="ai-bot@zilar.test/desk"><body>…attempted to retract…</body><retract xmlns="urn:xmpp:message-retract:1" id="${target}"/></message>`;
}

describe('summarizeUnread', () => {
  it('counts a same-album run once and previews the photo count when newest', () => {
    const page: UnreadRows = [
      dmRow('p-2', albumXml(2)),
      dmRow('p-1', albumXml(1)),
      dmRow('p-0', albumXml(0)),
      dmRow('plain', plainXml(), 'hello'),
    ];

    const answer = summarizeUnread(page, CHATS, ALLOWED, OWN_JID);

    expect(answer[CHAT_JID]?.unread).toBe(2);
    expect(answer[CHAT_JID]?.lastMessage?.text).toBe('3 photos');
    expect(answer[CHAT_JID]?.lastMessage?.id).toBe('p-2');
  });

  it('keeps a plain newest row as the preview', () => {
    const page: UnreadRows = [dmRow('plain', plainXml(), 'hello'), dmRow('p-0', albumXml(0))];

    const answer = summarizeUnread(page, CHATS, ALLOWED, OWN_JID);

    expect(answer[CHAT_JID]?.unread).toBe(2);
    expect(answer[CHAT_JID]?.lastMessage?.text).toBe('hello');
  });

  it('counts two different albums separately', () => {
    const page: UnreadRows = [
      dmRow('b-2', albumXml(2, 'alb-b')),
      dmRow('b-1', albumXml(1, 'alb-b')),
      dmRow('a-0', albumXml(0, 'alb-a')),
    ];

    const answer = summarizeUnread(page, CHATS, ALLOWED, OWN_JID);

    expect(answer[CHAT_JID]?.unread).toBe(2);
  });

  it('skips a card, its edit and its retraction: only the answer counts and previews', () => {
    // Newest first, like the batch read: the answer arrived last.
    const page: UnreadRows = [
      dmRow('answer', plainXml(), 'Here is the answer'),
      dmRow('retract', retractionXml('card')),
      dmRow('edit', correctionXml('card')),
      dmRow('card', progressXml()),
    ];

    const answer = summarizeUnread(page, CHATS, ALLOWED, OWN_JID);

    expect(answer[CHAT_JID]?.unread).toBe(1);
    expect(answer[CHAT_JID]?.lastMessage?.id).toBe('answer');
    expect(answer[CHAT_JID]?.lastMessage?.text).toBe('Here is the answer');
  });

  it('leaves the badge and the preview alone when the only new row is a card', () => {
    const page: UnreadRows = [dmRow('card', progressXml())];

    const answer = summarizeUnread(page, CHATS, ALLOWED, OWN_JID);

    // No counted row and no preview: the fallback read below the mark supplies
    // the chat's newest real message (or none), never the card.
    expect(answer[CHAT_JID]).toBeUndefined();
  });

  it('walks past a card run to the newest real row, whatever the row order', () => {
    const base = BigInt(Date.now()) * 1000n;
    const at = (offset: bigint) => base + offset;
    // Deliberately out of order: the timestamp sort, not the input order, must
    // pick the newest real row (the answer that arrives after the card).
    const rows: UnreadRows = [
      { ...dmRow('older', plainXml(), 'older message'), timestamp: at(0n) },
      { ...dmRow('answer', plainXml(), 'the answer'), timestamp: at(5n) },
      { ...dmRow('card', progressXml()), timestamp: at(2n) },
      { ...dmRow('retract', retractionXml('card')), timestamp: at(4n) },
      { ...dmRow('edit', correctionXml('card')), timestamp: at(3n) },
    ];

    expect(newestUnskippedRow(rows, CHAT_JID)?.originId).toBe('answer');
  });

  it('does not count a room row whose nick is the caller but whose bare_peer is another user', () => {
    const page: UnreadRows = [roomRow('spoofed', OWN_LOCALPART, 'ana@zilar.test')];
    const names = new Map([['ana@zilar.test', 'Ana']]);

    const answer = summarizeUnread(page, ROOM_CHATS, ALLOWED, OWN_JID, names);

    expect(answer[ROOM]?.unread).toBe(1);
    expect(answer[ROOM]?.lastMessage?.senderName).toBe('Ana');
  });

  it('counts a room row as the caller from bare_peer, not from a stranger nick', () => {
    const page: UnreadRows = [roomRow('mine', 'Pretender', OWN_JID)];
    const names = new Map([[OWN_JID, 'Me Myself']]);

    const answer = summarizeUnread(page, ROOM_CHATS, ALLOWED, OWN_JID, names);

    // The caller's own message never bumps the badge, even under a stolen nick.
    expect(answer[ROOM]?.unread).toBe(0);
    expect(answer[ROOM]?.lastMessage?.senderName).toBe('Me Myself');
  });

  it('treats a legacy room row with no bare_peer as the caller by its nick', () => {
    const page: UnreadRows = [roomRow('legacy-mine', OWN_LOCALPART.toUpperCase(), '')];

    const answer = summarizeUnread(page, ROOM_CHATS, ALLOWED, OWN_JID);

    expect(answer[ROOM]?.unread).toBe(0);
  });

  it('falls back to the nick when no display name exists for the sender JID', () => {
    const page: UnreadRows = [roomRow('legacy', 'Legacy Nick', 'stranger@zilar.test')];

    const answer = summarizeUnread(page, ROOM_CHATS, ALLOWED, OWN_JID);

    expect(answer[ROOM]?.unread).toBe(1);
    expect(answer[ROOM]?.lastMessage?.senderName).toBe('Legacy Nick');
  });
});
