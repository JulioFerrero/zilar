import { describe, expect, it } from 'vitest';
import { loadEditsForTargets } from './edit-overlay';
import type { ArchivePool, ArchiveRow } from './service';

const TS = 1_780_000_000_000_000n;

function at(offset: bigint): bigint {
  return TS + offset * 1_000_000n;
}

function row(overrides: Partial<ArchiveRow> & { originId: string; timestamp: bigint }): ArchiveRow {
  return {
    owner: 'alice',
    peer: 'bob@zilar.localhost',
    barePeer: 'bob@zilar.localhost',
    kind: 'chat',
    nick: '',
    headline: '',
    xml: '<message type="chat" from="bob@zilar.localhost/phone"><body>x</body></message>',
    body: '',
    ...overrides,
  };
}

function retraction(target: string, from: string, timestamp: bigint): ArchiveRow {
  return row({
    originId: `retract-${target}`,
    timestamp,
    body: '…attempted to retract…',
    xml: `<message type="chat" from="${from}"><retract xmlns="urn:xmpp:message-retract:1" id="${target}"/></message>`,
  });
}

function fakeArchive(targets: ArchiveRow[], edits: ArchiveRow[]): { pool: ArchivePool } {
  return {
    pool: {
      query: async (text: string) => (text.includes('xml LIKE') ? edits : targets) as ArchiveRow[],
      close: async () => {},
    },
  };
}

const DM = { kind: 'dm', owner: 'alice', peer: 'bob@zilar.localhost' } as const;
const ROOM = { kind: 'room', room: 'room@zilar.localhost' } as const;

function roomRow(
  overrides: Partial<ArchiveRow> & { originId: string; timestamp: bigint },
): ArchiveRow {
  return row({
    owner: ROOM.room,
    peer: ROOM.room,
    kind: 'groupchat',
    nick: 'Bob',
    xml: `<message type="groupchat" from="${ROOM.room}/Bob"><body>x</body></message>`,
    ...overrides,
  });
}

describe('loadEditsForTargets', () => {
  it('marks a retraction from the target’s sender as retracted', async () => {
    const { pool } = fakeArchive(
      [row({ originId: 'm1', timestamp: at(10n) })],
      [retraction('m1', 'bob@zilar.localhost/phone', at(20n))],
    );

    const overlay = await loadEditsForTargets(pool, DM, ['m1']);

    expect(overlay.get('m1')).toEqual({ retracted: true });
  });

  it('ignores a retraction from another sender', async () => {
    const { pool } = fakeArchive(
      [row({ originId: 'm1', timestamp: at(10n) })],
      [retraction('m1', 'carol@zilar.localhost/phone', at(20n))],
    );

    const overlay = await loadEditsForTargets(pool, DM, ['m1']);

    expect(overlay.get('m1')).toBeUndefined();
  });

  it('drops a room retraction with the target nick but another bare_peer', async () => {
    const { pool } = fakeArchive(
      [roomRow({ originId: 'm1', timestamp: at(10n), barePeer: 'bob@zilar.localhost' })],
      [
        roomRow({
          originId: 'retract-m1',
          timestamp: at(20n),
          barePeer: 'carol@zilar.localhost',
          nick: 'Bob',
          body: '…attempted to retract…',
          xml: `<message type="groupchat" from="${ROOM.room}/Bob"><retract xmlns="urn:xmpp:message-retract:1" id="m1"/></message>`,
        }),
      ],
    );

    const overlay = await loadEditsForTargets(pool, ROOM, ['m1']);

    expect(overlay.get('m1')).toBeUndefined();
  });

  it('ignores a forged muc#user item on a room edit from another bare_peer', async () => {
    const { pool } = fakeArchive(
      [roomRow({ originId: 'm1', timestamp: at(10n), barePeer: 'bob@zilar.localhost' })],
      [
        roomRow({
          originId: 'edit-m1',
          timestamp: at(20n),
          barePeer: 'carol@zilar.localhost',
          nick: 'Bob',
          body: 'forged',
          xml: `<message type="groupchat" from="${ROOM.room}/Bob"><body>forged</body><replace xmlns="urn:xmpp:message-correct:0" id="m1"/><x xmlns="http://jabber.org/protocol/muc#user"><item jid="bob@zilar.localhost"/></x></message>`,
        }),
      ],
    );

    const overlay = await loadEditsForTargets(pool, ROOM, ['m1']);

    expect(overlay.get('m1')).toBeUndefined();
  });
});
