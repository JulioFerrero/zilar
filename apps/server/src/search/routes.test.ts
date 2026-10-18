// T-2014: a search hit names a room sender from the archive's `bare_peer`,
// through our own tables. The MUC nick is free text anyone can take, so it is
// never the name shown.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedGroup, seedUser } from '../test-support/seed';
import { localpartFor } from '../xmpp/provisioning';
import { runSearchEffect } from './routes';
import type { ArchivePool, ArchiveRow } from './service';

// Lets one test make the batched name lookup reject, the way a transient DB
// failure would; every other test passes through to the real lookup.
const nameLookup = vi.hoisted(() => ({ fail: false }));
vi.mock('../xmpp/archive-sender', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../xmpp/archive-sender')>();
  return {
    ...actual,
    senderNamesByJid: async (...args: Parameters<typeof actual.senderNamesByJid>) => {
      if (nameLookup.fail) {
        throw new Error('name lookup failed');
      }
      return actual.senderNamesByJid(...args);
    },
  };
});

const SECRET = 'The secretword is here';

async function seedAccount(context: TestContext, userId: string): Promise<string> {
  const jid = `${localpartFor(userId)}@${context.config.xmpp.domain}`;
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO xmpp_accounts (user_id, localpart, jid, provisioned)
        VALUES (${userId}, ${localpartFor(userId)}, ${jid}, true)`;
    }),
  );
  return jid;
}

function roomRow(roomJid: string, anaJid: string): ArchiveRow {
  return {
    owner: roomJid,
    peer: roomJid,
    barePeer: anaJid,
    kind: 'groupchat',
    // The nick claims to be someone else; only `barePeer` decides.
    nick: 'Julio',
    originId: 'm-1',
    timestamp: BigInt(Date.now() - 60_000) * 1000n,
    headline: SECRET,
    body: SECRET,
    xml: `<message type="groupchat" from="${roomJid}/Julio"><body>${SECRET}</body></message>`,
  };
}

function fakeArchive(row: ArchiveRow): ArchivePool {
  return {
    query: async (text: string) => (text.includes('xml LIKE') ? [] : [row]),
    close: async () => {},
  };
}

async function roomFixture(
  context: TestContext,
): Promise<{ ownerId: string; anaJid: string; roomJid: string }> {
  const ownerId = await seedUser(context, { name: 'Owner' });
  const anaId = await seedUser(context, { name: 'Ana' });
  const anaJid = await seedAccount(context, anaId);
  const { generalTopicId } = await seedGroup(
    context,
    ownerId,
    [{ userId: ownerId, role: 'owner' }],
    [],
  );
  const [topic] = await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ roomLocalpart: string }>`SELECT room_localpart AS "roomLocalpart"
        FROM topics WHERE id = ${generalTopicId}`;
    }),
  );
  const roomJid = `${topic?.roomLocalpart ?? ''}@${context.config.xmpp.mucDomain}`;
  return { ownerId, anaJid, roomJid };
}

describe('runSearchEffect room sender names', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    nameLookup.fail = false;
    await context.close();
  });

  it('shows the database name for bare_peer, not a spoofed nick', async () => {
    const { ownerId, anaJid, roomJid } = await roomFixture(context);

    const result = await Effect.runPromise(
      runSearchEffect(
        {
          auth: context.auth,
          db: context.db,
          config: context.config,
          logger: context.logger,
          archive: fakeArchive(roomRow(roomJid, anaJid)),
        },
        ownerId,
        { q: 'secretword', chat: roomJid },
      ),
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.senderName).toBe('Ana');
  });

  it('keeps the hits with fallback names when the name lookup fails', async () => {
    const { ownerId, anaJid, roomJid } = await roomFixture(context);
    nameLookup.fail = true;

    const result = await Effect.runPromise(
      runSearchEffect(
        {
          auth: context.auth,
          db: context.db,
          config: context.config,
          logger: context.logger,
          archive: fakeArchive(roomRow(roomJid, anaJid)),
        },
        ownerId,
        { q: 'secretword', chat: roomJid },
      ),
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.senderName).toBe('Julio');
  });
});
