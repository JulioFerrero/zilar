// T-1774: the read-only preview of a public topic a group member has not
// joined. The permissions answer the same 404 as a missing id for anything the
// caller may not preview (private, General, or outside the group).
import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import type { ArchivePool, ArchiveRow } from '../search/service';
import {
  bootstrapUser,
  createTestContext,
  TEST_BASE_URL,
  TEST_XMPP_MUC_DOMAIN,
  testSql,
  type TestContext,
} from '../test-support';
import { seedGroup } from '../test-support/seed';

const ROOM_JID = `roompub@${TEST_XMPP_MUC_DOMAIN}`;
const BOB = 'bob@zilar.localhost';

function row(overrides: Partial<ArchiveRow> & { originId: string; timestamp: bigint }): ArchiveRow {
  return {
    owner: ROOM_JID,
    peer: ROOM_JID,
    barePeer: BOB,
    kind: 'groupchat',
    nick: 'Bob',
    headline: '',
    xml: '<message type="groupchat"><body>x</body></message>',
    body: '',
    ...overrides,
  };
}

function fakeArchive(
  roomJid: string,
  messages: ArchiveRow[],
  edits: ArchiveRow[] = [],
): ArchivePool {
  return {
    query: async (text: string, values: unknown[]) => {
      expect(values[0]).toBe(roomJid);
      return text.includes('xml LIKE') ? edits : messages;
    },
    close: async () => {},
  };
}

const TS = 1_780_000_000_000_000n;
function at(offset: number): bigint {
  return TS + BigInt(offset) * 1_000_000n;
}

describe('GET /api/topics/:id/preview', () => {
  let context: TestContext;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  function buildApp(archive: ArchivePool): void {
    app = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
      archive,
    });
  }

  async function seedTopic(
    groupId: string,
    createdBy: string,
    overrides: { name: string; roomLocalpart: string; visibility?: string; isGeneral?: boolean },
  ): Promise<string> {
    const topicId = randomUUID();
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO topics ${sql.insert({
          id: topicId,
          group_id: groupId,
          name: overrides.name,
          glyph: 'T',
          room_localpart: overrides.roomLocalpart,
          visibility: overrides.visibility ?? 'public',
          kind: 'chat',
          status: 'open',
          is_general: overrides.isGeneral ?? false,
          created_by: createdBy,
        })}`;
      }),
    );
    return topicId;
  }

  async function preview(cookie: string | undefined, topicId: string) {
    const response = await app.request(`${TEST_BASE_URL}/api/topics/${topicId}/preview`, {
      headers: cookie === undefined ? {} : { cookie },
    });
    const json: unknown = await response.json().catch(() => null);
    return { status: response.status, json };
  }

  function errorCode(json: unknown): string | undefined {
    if (typeof json !== 'object' || json === null || !('error' in json)) {
      return undefined;
    }
    const error = (json as { error: unknown }).error;
    if (typeof error !== 'object' || error === null || !('code' in error)) {
      return undefined;
    }
    return (error as { code: unknown }).code as string;
  }

  async function setup() {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await bootstrapUser(context, app, 'member@example.com');
    const outsider = await bootstrapUser(context, app, 'outsider@example.com');
    const { groupId, generalTopicId } = await seedGroup(
      context,
      owner.id,
      [
        { userId: owner.id, role: 'owner' },
        { userId: member.id, role: 'member' },
      ],
      [],
    );
    return { owner, member, outsider, groupId, generalTopicId };
  }

  it('lets a group member read a public topic they have not joined, oldest first', async () => {
    buildApp(
      fakeArchive(ROOM_JID, [
        row({ originId: 'm2', timestamp: at(20), body: 'second' }),
        row({ originId: 'm1', timestamp: at(10), body: 'first' }),
      ]),
    );
    const { member, outsider, groupId, generalTopicId } = await setup();
    const publicTopicId = await seedTopic(groupId, member.id, {
      name: 'Announcements',
      roomLocalpart: 'roompub',
    });
    const privateTopicId = await seedTopic(groupId, member.id, {
      name: 'Secret',
      roomLocalpart: 'roomsec',
      visibility: 'private',
    });

    const ok = await preview(member.cookie, publicTopicId);
    expect(ok.status).toBe(200);
    expect(
      (ok.json as { messages: Array<{ id: string; body: string; nick: string }> }).messages,
    ).toEqual([
      { id: 'm1', at: new Date(Number(at(10) / 1_000n)).toISOString(), nick: 'Bob', body: 'first' },
      {
        id: 'm2',
        at: new Date(Number(at(20) / 1_000n)).toISOString(),
        nick: 'Bob',
        body: 'second',
      },
    ]);

    // A private topic the member is not in, the General topic, and an outsider
    // all answer the same 404 as a missing id.
    for (const [cookie, topicId] of [
      [member.cookie, privateTopicId],
      [member.cookie, generalTopicId],
      [outsider.cookie, publicTopicId],
    ] as const) {
      const denied = await preview(cookie, topicId);
      expect(denied.status).toBe(404);
      expect(errorCode(denied.json)).toBe('not_found');
    }
  });
});
