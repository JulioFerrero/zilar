import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ChatMessage } from '@zilar/xmpp-core';
import type { FetchLike } from '../ai/litellm-client';
import { createKeyCipher } from '../connections/crypto';
import type { ActionGateway } from '../actions/gateway';
import {
  createTestContext,
  TEST_XMPP_DOMAIN,
  TEST_XMPP_MUC_DOMAIN,
  testSql,
  type TestContext,
} from '../test-support';
import { emitTopicAi } from '../groups/events';
import { localpartFor } from '../xmpp/provisioning';
import { stopAi, type AiServiceDeps } from '../ais/service';
import { type AgentGateway } from './gateway';
import {
  completionResponse,
  createGatewayHelpers,
  FakeCore,
  FakeLitellm,
  jsonResponse,
  MASTER_KEY,
  seedAi,
  tick,
  waitFor,
  type Call,
  type SeededAi,
} from './gateway.test-harness';

describe('agent gateway', () => {
  let context: TestContext;
  let gateway: AgentGateway | undefined;

  beforeEach(async () => {
    context = await createTestContext();
    gateway = undefined;
  });

  afterEach(async () => {
    if (gateway !== undefined) {
      await gateway.stop();
      gateway = undefined;
    }
    await context.close();
  });

  const { harness, completionFetch, bodyOf, coreFor } = createGatewayHelpers({
    getContext: () => context,
    setGateway: (created) => {
      gateway = created;
    },
  });

  // T-0109: an AI reads and answers only in the topics it was added to. The
  // fixtures live inside this describe so the group tests above keep seeding
  // the group's own room only.
  describe('topics (T-0109)', () => {
    const NOW = new Date('2026-09-28T12:00:00Z');
    async function seedTopicSetup(
      input: {
        withMember?: boolean;
        visibility?: 'public' | 'private';
      } = {},
    ): Promise<{
      seeded: SeededAi;
      member: { userId: string; jid: string };
      outsider: { userId: string; jid: string };
      groupId: string;
      generalJid: string;
      generalId: string;
      topicId: string;
      topicJid: string;
      topicName: string;
      core: FakeCore;
      calls: Call[];
      litellm: FakeLitellm;
    }> {
      const seeded = await seedAi(context, { name: 'Topic AI' });
      const member = await (async () => {
        const userId = randomUUID();
        const memberEmail = `${userId}@example.com`;
        await testSql(context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`INSERT INTO "user" ${sql.insert({
              id: userId,
              name: 'Ana',
              email: memberEmail,
            })}`;
          }),
        );
        return { userId, jid: `${localpartFor(userId)}@${TEST_XMPP_DOMAIN}` };
      })();
      const outsider = await (async () => {
        const userId = randomUUID();
        const outsiderEmail = `${userId}@example.com`;
        await testSql(context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`INSERT INTO "user" ${sql.insert({
              id: userId,
              name: 'Out',
              email: outsiderEmail,
            })}`;
          }),
        );
        return { userId, jid: `${localpartFor(userId)}@${TEST_XMPP_DOMAIN}` };
      })();
      const groupId = randomUUID();
      const generalLocalpart = `gtopic${randomUUID().replace(/-/g, '').slice(0, 10)}`;
      const topicLocalpart = `ttopic${randomUUID().replace(/-/g, '').slice(0, 10)}`;
      const visibility = input.visibility ?? 'public';
      const topicName = 'Backend';
      const generalId = randomUUID();
      const topicId = randomUUID();
      const groupMembersRows = [
        { group_id: groupId, user_id: seeded.ownerId, role: 'owner' },
        { group_id: groupId, user_id: member.userId, role: 'member' },
        { group_id: groupId, user_id: outsider.userId, role: 'member' },
      ];
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO groups ${sql.insert({
            id: groupId,
            room_localpart: generalLocalpart,
            title: 'Team',
            created_by: seeded.ownerId,
          })}`;
          yield* sql`INSERT INTO group_members ${sql.insert(groupMembersRows)}`;
          yield* sql`INSERT INTO group_ais ${sql.insert({
            group_id: groupId,
            ai_id: seeded.aiId,
            added_by: seeded.ownerId,
          })}`;
          yield* sql`INSERT INTO topics ${sql.insert({
            id: generalId,
            group_id: groupId,
            name: 'General',
            glyph: 'G',
            room_localpart: generalLocalpart,
            visibility: 'public',
            kind: 'chat',
            status: 'open',
            is_general: true,
            created_by: seeded.ownerId,
          })}`;
          yield* sql`INSERT INTO topics ${sql.insert({
            id: topicId,
            group_id: groupId,
            name: topicName,
            glyph: 'B',
            room_localpart: topicLocalpart,
            visibility,
            kind: 'chat',
            status: 'open',
            is_general: false,
            created_by: seeded.ownerId,
          })}`;
        }),
      );
      if (visibility === 'private') {
        const privateRows = [
          { topic_id: topicId, user_id: seeded.ownerId, added_by: seeded.ownerId },
          { topic_id: topicId, user_id: member.userId, added_by: seeded.ownerId },
        ];
        await testSql(context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`INSERT INTO topic_members ${sql.insert(privateRows)}`;
          }),
        );
      }
      if (input.withMember !== false) {
        await testSql(context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`INSERT INTO topic_ais ${sql.insert({
              topic_id: topicId,
              ai_id: seeded.aiId,
              added_by: seeded.ownerId,
            })}`;
          }),
        );
      }
      const generalJid = `${generalLocalpart}@${TEST_XMPP_MUC_DOMAIN}`;
      const topicJid = `${topicLocalpart}@${TEST_XMPP_MUC_DOMAIN}`;
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = completionFetch('topic reply');
      const litellm = new FakeLitellm();
      const { gateway: started } = harness(cores, fetchImpl, litellm);
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);
      return {
        seeded,
        member,
        outsider,
        groupId,
        generalJid,
        generalId,
        topicId,
        topicJid,
        topicName,
        core,
        calls,
        litellm,
      };
    }

    function topicMention(
      seeded: SeededAi,
      member: { jid: string },
      roomJid: string,
      id: string,
    ): ChatMessage {
      return {
        id,
        chatJid: roomJid,
        kind: 'groupchat',
        fromJid: member.jid,
        fromResolved: true,
        fromNick: 'Ana',
        body: 'hey, what do you think?',
        mentions: [{ jid: seeded.aiJid }],
        timestamp: NOW,
        outgoing: false,
      };
    }

    it('joins General plus its topics only', async () => {
      const { topicJid, generalJid, core } = await seedTopicSetup();
      expect(core.joined).toEqual(
        expect.arrayContaining([
          { roomJid: generalJid, nick: 'Topic AI' },
          { roomJid: topicJid, nick: 'Topic AI' },
        ]),
      );
      expect(core.joined).toHaveLength(2);
    });

    it('answers a mention in a topic it is in, naming that topic only', async () => {
      const { seeded, member, topicJid, generalJid, topicName, core, calls } =
        await seedTopicSetup();
      core.receive(topicMention(seeded, member, topicJid, 'm-1'));
      await waitFor(() => calls.length === 1);
      const messages = bodyOf(calls[0]!).messages;
      expect(messages[0]?.role).toBe('system');
      expect(messages[0]?.content).toContain(`You are in the topic ${topicName} of the group Team`);
      expect(messages[0]?.content).not.toContain('General');
      expect(core.sent).toEqual([
        {
          to: topicJid,
          kind: 'groupchat',
          text: '@Ana topic reply',
          opts: {
            replyTo: { id: 'm-1' },
            mentions: [{ jid: member.jid, begin: 0, end: 4 }],
          },
        },
      ]);
      expect(calls).toHaveLength(1);
      void generalJid;
    });

    it('ignores a mention in a private topic it is not in (never joined, never answered)', async () => {
      const { seeded, member, topicJid, core, calls } = await seedTopicSetup({
        withMember: false,
        visibility: 'private',
      });
      // The AI never joined the private room: only General.
      expect(core.joined.map((join) => join.roomJid)).not.toContain(topicJid);
      expect(core.joined).toHaveLength(1);
      core.receive(topicMention(seeded, member, topicJid, 'm-1'));
      await tick(200);
      expect(calls).toHaveLength(0);
      expect(core.sent).toHaveLength(0);
    });

    it('leaves a private room when its owner is removed, and never answers there again', async () => {
      const { seeded, member, topicId, topicJid, core, calls } = await seedTopicSetup({
        visibility: 'private',
      });
      // The AI starts in the private room (its owner is a member).
      expect(core.joined.map((join) => join.roomJid)).toContain(topicJid);

      // The owner is removed from the topic: the gateway leaves on the
      // emitted event, and a later mention never reaches the model.
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`DELETE FROM topic_members
            WHERE topic_id = ${topicId} AND user_id = ${seeded.ownerId}`;
        }),
      );
      emitTopicAi({ type: 'ai-removed', topicId, aiId: seeded.aiId });
      await waitFor(() => core.left.includes(topicJid));

      core.receive(topicMention(seeded, member, topicJid, 'm-1'));
      await tick(250);
      expect(calls).toHaveLength(0);
      expect(core.sent).toHaveLength(0);

      // Reconcile agrees: with the owner still out, the room stays left.
      const joinedBefore = core.joined.length;
      await gateway!.reconcile();
      await tick(100);
      expect(core.joined.length).toBe(joinedBefore);
    });

    it('joins on the topic ai-added event and leaves on ai-removed', async () => {
      const { seeded, topicId, topicJid, core } = await seedTopicSetup({ withMember: false });
      expect(core.joined.map((join) => join.roomJid)).not.toContain(topicJid);

      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO topic_ais ${sql.insert({
            topic_id: topicId,
            ai_id: seeded.aiId,
            added_by: seeded.ownerId,
          })}`;
        }),
      );
      emitTopicAi({ type: 'ai-added', topicId, aiId: seeded.aiId });
      await waitFor(() => core.joined.some((join) => join.roomJid === topicJid));

      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`DELETE FROM topic_ais WHERE topic_id = ${topicId} AND ai_id = ${seeded.aiId}`;
        }),
      );
      emitTopicAi({ type: 'ai-removed', topicId, aiId: seeded.aiId });
      await waitFor(() => core.left.includes(topicJid));
    });

    it('rejects a group admin who is not a member of a private topic, accepts one who is', async () => {
      const adminId = randomUUID();
      const adminJid = `${localpartFor(adminId)}@${TEST_XMPP_DOMAIN}`;
      const seeded = await seedAi(context, { name: 'Topic AI' });
      const groupId = randomUUID();
      const generalLocalpart = `gadm${randomUUID().replace(/-/g, '').slice(0, 11)}`;
      const topicLocalpart = `tadm${randomUUID().replace(/-/g, '').slice(0, 11)}`;
      const generalTopicId = randomUUID();
      const topicId = randomUUID();
      const topicMembersRows = [
        { topic_id: topicId, user_id: adminId, added_by: adminId },
        // The AI counts in a private room only while its owner is a topic
        // member too (derived rule): add the owner so the turn below runs.
        { topic_id: topicId, user_id: seeded.ownerId, added_by: adminId },
      ];
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO "user" ${sql.insert({
            id: adminId,
            name: 'Bea',
            email: `${adminId}@example.com`,
          })}`;
          yield* sql`INSERT INTO groups ${sql.insert({
            id: groupId,
            room_localpart: generalLocalpart,
            title: 'Team',
            created_by: adminId,
          })}`;
          yield* sql`INSERT INTO group_members ${sql.insert([
            { group_id: groupId, user_id: adminId, role: 'admin' },
            { group_id: groupId, user_id: seeded.ownerId, role: 'owner' },
          ])}`;
          yield* sql`INSERT INTO group_ais ${sql.insert({
            group_id: groupId,
            ai_id: seeded.aiId,
            added_by: seeded.ownerId,
          })}`;
          yield* sql`INSERT INTO topics ${sql.insert({
            id: generalTopicId,
            group_id: groupId,
            name: 'General',
            glyph: 'G',
            room_localpart: generalLocalpart,
            visibility: 'public',
            kind: 'chat',
            status: 'open',
            is_general: true,
            created_by: adminId,
          })}`;
          yield* sql`INSERT INTO topics ${sql.insert({
            id: topicId,
            group_id: groupId,
            name: 'Hiring',
            glyph: 'H',
            room_localpart: topicLocalpart,
            visibility: 'private',
            kind: 'chat',
            status: 'open',
            is_general: false,
            created_by: adminId,
          })}`;
          yield* sql`INSERT INTO topic_members ${sql.insert(topicMembersRows)}`;
          yield* sql`INSERT INTO topic_ais ${sql.insert({
            topic_id: topicId,
            ai_id: seeded.aiId,
            added_by: seeded.ownerId,
          })}`;
        }),
      );
      const topicJid = `${topicLocalpart}@${TEST_XMPP_MUC_DOMAIN}`;

      const scripted: Call[] = [];
      const responses: Response[] = [
        jsonResponse({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call-1',
                    type: 'function',
                    function: {
                      name: 'request_action',
                      arguments: JSON.stringify({ action: 'demo.echo', args: { text: 'hi' } }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        completionResponse('done'),
      ];
      let index = 0;
      const fetchImpl: FetchLike = (_url, init) => {
        scripted.push({ url: _url, init: init ?? { headers: new Headers() } });
        const response = responses[Math.min(index, responses.length - 1)]!;
        index += 1;
        return Promise.resolve(response.clone());
      };
      const requests: Array<{ aiId: string; groupId?: string }> = [];
      const actions: ActionGateway = {
        request: (params) => {
          requests.push({
            aiId: params.aiId,
            ...(params.groupId === undefined ? {} : { groupId: params.groupId }),
          });
          return Promise.resolve({ status: 'executed', summary: 'Echoed: hi' });
        },
        onApprovalDecided: () => Promise.resolve(),
        recoverStuck: () => Promise.resolve(),
        listActions: () => [{ name: 'demo.echo', description: 'Repeats text.' }],
      };
      const cores: FakeCore[] = [];
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm(), { actions });
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      // The admin is a topic member: the turn runs and the tool is offered.
      core.receive({
        id: 'm-1',
        chatJid: topicJid,
        kind: 'groupchat',
        fromJid: adminJid,
        fromResolved: true,
        fromNick: 'Bea',
        body: 'please run it',
        mentions: [{ jid: seeded.aiJid }],
        timestamp: NOW,
        outgoing: false,
      });
      await waitFor(() => requests.length === 1);
      expect(scripted.length).toBeGreaterThanOrEqual(1);

      // Remove the admin from the private topic: the gate no longer sees
      // them, so the mention starts no turn.
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`DELETE FROM topic_members WHERE topic_id = ${topicId} AND user_id = ${adminId}`;
        }),
      );
      const callsBefore = scripted.length;
      core.receive({
        id: 'm-2',
        chatJid: topicJid,
        kind: 'groupchat',
        fromJid: adminJid,
        fromResolved: true,
        fromNick: 'Bea',
        body: 'please run it again',
        mentions: [{ jid: seeded.aiJid }],
        timestamp: NOW,
        outgoing: false,
      });
      await tick(250);
      expect(scripted.length).toBe(callsBefore);
      expect(requests).toHaveLength(1);
    });

    it('postToChat with a topicId posts into that room, and false when the AI is not in it', async () => {
      const { seeded, groupId, topicId, topicJid, core } = await seedTopicSetup();
      const started = gateway;
      expect(started).toBeDefined();
      const ok = await started!.postToChat({
        aiId: seeded.aiId,
        groupId,
        topicId,
        text: 'topic card',
      });
      expect(ok).toBe(true);
      expect(core.sent).toEqual([
        { to: topicJid, kind: 'groupchat', text: 'topic card', opts: {} },
      ]);

      // An AI that was never added to the topic answers false and sends
      // nothing: remove the row first (the gateway leaves on reconcile).
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`DELETE FROM topic_ais WHERE topic_id = ${topicId} AND ai_id = ${seeded.aiId}`;
        }),
      );
      await started!.reconcile();
      await waitFor(() => core.left.includes(topicJid));
      const sentBefore = core.sent.length;
      const denied = await started!.postToChat({
        aiId: seeded.aiId,
        groupId,
        topicId,
        text: 'late card',
      });
      expect(denied).toBe(false);
      expect(core.sent.length).toBe(sentBefore);
    });

    it('a stopped AI still posts nothing with a topicId', async () => {
      const { seeded, groupId, topicId, core } = await seedTopicSetup();
      const deps: AiServiceDeps = {
        db: context.db,
        adminClient: context.adminClient,
        litellm: new FakeLitellm(),
        cipher: createKeyCipher(MASTER_KEY),
        logger: context.logger,
        domain: context.xmppConfig.domain,
      };
      const started = gateway;
      expect(started).toBeDefined();
      await stopAi(deps, seeded.aiId, seeded.ownerId);
      await waitFor(() => started!.size() === 0);
      const ok = await started!.postToChat({
        aiId: seeded.aiId,
        groupId,
        topicId,
        text: 'after-stop',
      });
      expect(ok).toBe(false);
      expect(core.sent).toEqual([]);
    });

    it('no other topic name appears in any prompt', async () => {
      const seeded = await seedAi(context, { name: 'Topic AI' });
      const memberId = randomUUID();
      const memberJid = `${localpartFor(memberId)}@${TEST_XMPP_DOMAIN}`;
      const groupId = randomUUID();
      const generalLocalpart = `gsec${randomUUID().replace(/-/g, '').slice(0, 11)}`;
      const firstLocalpart = `tsec${randomUUID().replace(/-/g, '').slice(0, 11)}`;
      const secondLocalpart = `usec${randomUUID().replace(/-/g, '').slice(0, 11)}`;
      const generalTopicId = randomUUID();
      const firstId = randomUUID();
      const secondId = randomUUID();
      const topicAisRows = [
        { topic_id: firstId, ai_id: seeded.aiId, added_by: seeded.ownerId },
        { topic_id: secondId, ai_id: seeded.aiId, added_by: seeded.ownerId },
      ];
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO "user" ${sql.insert({
            id: memberId,
            name: 'Ana',
            email: `${memberId}@example.com`,
          })}`;
          yield* sql`INSERT INTO groups ${sql.insert({
            id: groupId,
            room_localpart: generalLocalpart,
            title: 'Team',
            created_by: seeded.ownerId,
          })}`;
          yield* sql`INSERT INTO group_members ${sql.insert([
            { group_id: groupId, user_id: seeded.ownerId, role: 'owner' },
            { group_id: groupId, user_id: memberId, role: 'member' },
          ])}`;
          yield* sql`INSERT INTO group_ais ${sql.insert({
            group_id: groupId,
            ai_id: seeded.aiId,
            added_by: seeded.ownerId,
          })}`;
          yield* sql`INSERT INTO topics ${sql.insert({
            id: generalTopicId,
            group_id: groupId,
            name: 'General',
            glyph: 'G',
            room_localpart: generalLocalpart,
            visibility: 'public',
            kind: 'chat',
            status: 'open',
            is_general: true,
            created_by: seeded.ownerId,
          })}`;
          yield* sql`INSERT INTO topics ${sql.insert({
            id: firstId,
            group_id: groupId,
            name: 'Backend Secrets',
            glyph: 'B',
            room_localpart: firstLocalpart,
            visibility: 'public',
            kind: 'chat',
            status: 'open',
            is_general: false,
            created_by: seeded.ownerId,
          })}`;
          yield* sql`INSERT INTO topics ${sql.insert({
            id: secondId,
            group_id: groupId,
            name: 'Hiring Secrets',
            glyph: 'H',
            room_localpart: secondLocalpart,
            visibility: 'public',
            kind: 'chat',
            status: 'open',
            is_general: false,
            created_by: seeded.ownerId,
          })}`;
          yield* sql`INSERT INTO topic_ais ${sql.insert(topicAisRows)}`;
        }),
      );
      const firstJid = `${firstLocalpart}@${TEST_XMPP_MUC_DOMAIN}`;
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = completionFetch('ok');
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      void started;
      const core = await coreFor(cores, seeded.aiJid);
      core.receive({
        id: 'm-1',
        chatJid: firstJid,
        kind: 'groupchat',
        fromJid: memberJid,
        fromResolved: true,
        fromNick: 'Ana',
        body: 'hey, thoughts?',
        mentions: [{ jid: seeded.aiJid }],
        timestamp: NOW,
        outgoing: false,
      });
      await waitFor(() => calls.length === 1);
      const dumped = JSON.stringify(calls.map((call) => JSON.parse(String(call.init.body))));
      expect(dumped).toContain('Backend Secrets');
      expect(dumped).not.toContain('Hiring Secrets');
      expect(dumped).not.toContain('General');
    });
  });
});
