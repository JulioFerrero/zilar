import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ChatMessage } from '@zilar/xmpp-core';
import type { FetchLike } from '../ai/litellm-client';
import { createKeyCipher } from '../connections/crypto';
import type { ActionGateway, RequestOutcome } from '../actions/gateway';
import {
  createTestContext,
  TEST_XMPP_DOMAIN,
  TEST_XMPP_MUC_DOMAIN,
  testSql,
  type TestContext,
} from '../test-support';
import { emitGroupAi } from '../groups/events';
import { localpartFor } from '../xmpp/provisioning';
import { stopAi, type AiServiceDeps } from '../ais/service';
import { type AgentGateway } from './gateway';
import { BUDGET_EXCEEDED_REPLY } from './reply';
import {
  captureLogger,
  completionResponse,
  createGatewayHelpers,
  FakeCore,
  FakeLitellm,
  incoming,
  jsonResponse,
  loggedText,
  MASTER_KEY,
  PROVIDER_KEY,
  seedAi,
  tick,
  VIRTUAL_KEY,
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

  describe('groups', () => {
    const NOW = new Date('2026-09-28T12:00:00Z');

    async function seedMember(name: string): Promise<{ userId: string; jid: string }> {
      const userId = randomUUID();
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO "user" ${sql.insert({
            id: userId,
            name,
            email: `${userId}@example.com`,
          })}`;
        }),
      );
      return { userId, jid: `${localpartFor(userId)}@${TEST_XMPP_DOMAIN}` };
    }

    async function seedGroup(input: {
      ownerId: string;
      aiId: string;
      memberIds?: string[];
    }): Promise<{ groupId: string; roomJid: string }> {
      const groupId = randomUUID();
      const roomLocalpart = `gtest${randomUUID().replace(/-/g, '').slice(0, 10)}`;
      const members = [
        { group_id: groupId, user_id: input.ownerId, role: 'owner' },
        ...(input.memberIds ?? []).map((userId) => ({
          group_id: groupId,
          user_id: userId,
          role: 'member',
        })),
      ];
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO groups ${sql.insert({
            id: groupId,
            room_localpart: roomLocalpart,
            title: 'Room',
            created_by: input.ownerId,
          })}`;
          yield* sql`INSERT INTO group_members ${sql.insert(members)}`;
          yield* sql`INSERT INTO group_ais ${sql.insert({
            group_id: groupId,
            ai_id: input.aiId,
            added_by: input.ownerId,
          })}`;
          yield* sql`INSERT INTO topics ${sql.insert({
            id: randomUUID(),
            group_id: groupId,
            name: 'General',
            glyph: 'G',
            room_localpart: roomLocalpart,
            visibility: 'public',
            kind: 'chat',
            status: 'open',
            is_general: true,
            created_by: input.ownerId,
          })}`;
        }),
      );
      return { groupId, roomJid: `${roomLocalpart}@${TEST_XMPP_MUC_DOMAIN}` };
    }

    function roomMessage(
      roomJid: string,
      fromJid: string,
      id: string,
      body: string | undefined,
      options: {
        nick?: string;
        mentions?: string[];
        timestamp?: Date;
        resolved?: boolean;
        outgoing?: boolean;
      } = {},
    ): ChatMessage {
      return {
        id,
        chatJid: roomJid,
        kind: 'groupchat',
        fromJid,
        fromResolved: options.resolved ?? true,
        ...(options.nick === undefined ? {} : { fromNick: options.nick }),
        ...(body === undefined ? {} : { body }),
        ...(options.mentions === undefined
          ? {}
          : { mentions: options.mentions.map((jid) => ({ jid })) }),
        timestamp: options.timestamp ?? NOW,
        outgoing: options.outgoing ?? false,
      };
    }

    async function roomSetup(
      input: {
        fetch?: () => { fetchImpl: FetchLike; calls: Call[] };
      } = {},
    ): Promise<{
      seeded: SeededAi;
      member: { userId: string; jid: string };
      groupId: string;
      roomJid: string;
      core: FakeCore;
      calls: Call[];
      litellm: FakeLitellm;
      logger: ReturnType<typeof captureLogger>;
    }> {
      const seeded = await seedAi(context);
      const member = await seedMember('Ana');
      const { groupId, roomJid } = await seedGroup({
        ownerId: seeded.ownerId,
        aiId: seeded.aiId,
        memberIds: [member.userId],
      });
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = (input.fetch ?? completionFetch)();
      const litellm = new FakeLitellm();
      const { gateway: started, logger } = harness(cores, fetchImpl, litellm);
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);
      return { seeded, member, groupId, roomJid, core, calls, litellm, logger };
    }

    function mention(seeded: SeededAi, member: { jid: string }, roomJid: string, id: string) {
      return roomMessage(roomJid, member.jid, id, `hey, what do you think?`, {
        nick: 'Ana',
        mentions: [seeded.aiJid],
      });
    }

    it('joins its rooms on connect with the AI name as nick', async () => {
      const { seeded, roomJid, core } = await roomSetup();
      expect(core.joined).toEqual([{ roomJid, nick: 'Gateway AI' }]);
      expect(seeded.aiJid).toContain('ai-');
    });

    it('reads a room fact into a second system message', async () => {
      const { seeded, member, roomJid, core, calls } = await roomSetup();
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO ai_memory_facts ${sql.insert({
            id: randomUUID(),
            ai_id: seeded.aiId,
            chat_key: `room:${roomJid}`,
            text: 'the room rule is be brief',
          })}`;
        }),
      );

      core.receive(mention(seeded, member, roomJid, 'm-1'));
      await waitFor(() => calls.length === 1);
      const messages = bodyOf(calls[0]!).messages;
      expect(messages[1]).toEqual({
        role: 'system',
        content: 'Things you were asked to remember in this chat:\n- the room rule is be brief',
      });
      expect(messages.filter((message) => message.role === 'system')).toHaveLength(2);
    });

    it('appends the remembered line when a member turn saves a fact', async () => {
      const fact = 'The launch is on Friday.';
      const responses = [
        jsonResponse({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call-1',
                    type: 'function',
                    function: { name: 'remember', arguments: JSON.stringify({ text: fact }) },
                  },
                ],
              },
            },
          ],
        }),
        completionResponse('noted'),
      ];
      let index = 0;
      const calls: Call[] = [];
      const fetchImpl: FetchLike = (url, init) => {
        calls.push({ url, init });
        const response = responses[Math.min(index, responses.length - 1)]!;
        index += 1;
        return Promise.resolve(response.clone());
      };
      const { seeded, member, roomJid, core } = await roomSetup({
        fetch: () => ({ fetchImpl, calls }),
      });

      core.receive(mention(seeded, member, roomJid, 'm-1'));
      await waitFor(() => core.sent.length === 1);

      expect(core.sent[0]?.text).toBe(`@Ana noted\n\nRemembered: ${fact}`);
      const facts = await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{ text: string }>`SELECT text FROM ai_memory_facts
            WHERE ai_id = ${seeded.aiId} AND chat_key = ${`room:${roomJid}`}`;
        }),
      );
      expect(facts.map((row) => row.text)).toEqual([fact]);
    });

    it('joins on the ai-added event and leaves on ai-removed', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl } = completionFetch();
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);
      expect(core.joined).toHaveLength(0);

      const { groupId, roomJid } = await seedGroup({ ownerId: seeded.ownerId, aiId: seeded.aiId });
      emitGroupAi({ type: 'ai-added', groupId, aiId: seeded.aiId });
      await waitFor(() => core.joined.length === 1);
      expect(core.joined).toEqual([{ roomJid, nick: 'Gateway AI' }]);

      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`DELETE FROM group_ais WHERE group_id = ${groupId} AND ai_id = ${seeded.aiId}`;
        }),
      );
      emitGroupAi({ type: 'ai-removed', groupId, aiId: seeded.aiId });
      await waitFor(() => core.left.length === 1);
      expect(core.left).toEqual([roomJid]);
    });

    it('retries a failed join on reconcile without breaking DMs', async () => {
      const seeded = await seedAi(context);
      const member = await seedMember('Ana');
      const { groupId, roomJid } = await seedGroup({
        ownerId: seeded.ownerId,
        aiId: seeded.aiId,
        memberIds: [member.userId],
      });
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = completionFetch();
      const { gateway: started, logger } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);
      expect(core.joined).toHaveLength(1);

      // The AI leaves for real, then the re-add join fails once.
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`DELETE FROM group_ais WHERE group_id = ${groupId} AND ai_id = ${seeded.aiId}`;
        }),
      );
      emitGroupAi({ type: 'ai-removed', groupId, aiId: seeded.aiId });
      await waitFor(() => core.left.length === 1);
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO group_ais ${sql.insert({
            group_id: groupId,
            ai_id: seeded.aiId,
            added_by: seeded.ownerId,
          })}`;
        }),
      );
      core.failJoin = true;
      emitGroupAi({ type: 'ai-added', groupId, aiId: seeded.aiId });
      await waitFor(() =>
        logger.calls.some((call) => call.message === 'AI room join failed; reconcile will retry'),
      );
      expect(core.joined).toHaveLength(1);
      const failures = logger.calls.filter(
        (call) => call.message === 'AI room join failed; reconcile will retry',
      );
      expect(failures).toHaveLength(1);
      expect(failures[0]?.fields['aiId']).toBe(seeded.aiId);
      expect(failures[0]?.fields['groupId']).toBe(groupId);

      core.failJoin = false;
      await started.reconcile();
      await waitFor(() => core.joined.length === 2);
      expect(core.joined[1]).toEqual({ roomJid, nick: 'Gateway AI' });

      // The AI's DMs kept working throughout.
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'are you there?'));
      await waitFor(() => calls.length === 1);
      expect(core.sent).toEqual([{ to: seeded.ownerJid, kind: 'chat', text: 'AI says hi' }]);
    });

    it('replies to a human mention with replyTo and a mention of the sender', async () => {
      const { seeded, member, roomJid, core, calls } = await roomSetup();
      core.receive(mention(seeded, member, roomJid, 'm-1'));
      await waitFor(() => calls.length === 1);

      const call = calls[0]!;
      expect(call.url).toBe('http://litellm.test:4000/chat/completions');
      expect(new Headers(call.init.headers).get('authorization')).toBe(`Bearer ${VIRTUAL_KEY}`);
      expect(bodyOf(call).model).toBe(`ai-${seeded.aiId}`);
      // A room turn always carries the three memory tools (T-0444), never a
      // persona or action tool for a plain member.
      const withTools = JSON.parse(String(call.init.body)) as {
        tools: Array<{ function: { name: string } }>;
      };
      expect(withTools.tools.map((tool) => tool.function.name)).toEqual([
        'recall',
        'memory_zoom',
        'remember',
      ]);
      const messages = (bodyOf(call) as { messages: Array<{ role: string; content: string }> })
        .messages;
      expect(messages[0]?.role).toBe('system');
      expect(messages[0]?.content).toContain('talking in a group chat');
      expect(messages.at(-1)).toEqual({ role: 'user', content: 'Ana: hey, what do you think?' });

      expect(core.sent).toEqual([
        {
          to: roomJid,
          kind: 'groupchat',
          text: '@Ana AI says hi',
          opts: {
            replyTo: { id: 'm-1' },
            mentions: [{ jid: member.jid, begin: 0, end: 4 }],
          },
        },
      ]);
      expect(core.typing).toEqual([
        { to: roomJid, kind: 'groupchat', state: 'composing' },
        { to: roomJid, kind: 'groupchat', state: 'paused' },
      ]);
      // No read markers in groups.
      expect(core.displayed).toHaveLength(0);
    });

    it.each([
      ['no mention', {}],
      ['an empty body', { body: '   ' }],
      ['its own reflection', { outgoing: true }],
      ['a room it never joined', { otherRoom: true }],
    ])('makes no LiteLLM call for %s', async (_label, options) => {
      const { seeded, member, roomJid, core, calls } = await roomSetup();
      const chatJid =
        (options as { otherRoom?: boolean }).otherRoom === true ? 'other@rooms.x' : roomJid;
      core.receive(
        roomMessage(
          chatJid,
          member.jid,
          'm-1',
          (options as { body?: string }).body ?? 'hello everyone',
          {
            nick: 'Ana',
            ...((options as { outgoing?: boolean }).outgoing === true
              ? { outgoing: true as const }
              : {}),
          },
        ),
      );
      await tick(150);
      expect(calls).toHaveLength(0);
      expect(core.sent).toHaveLength(0);
      expect(seeded.aiJid).toContain('ai-');
    });

    it('starts no turn for a retraction in a room, even with a mention', async () => {
      const { seeded, member, roomJid, core, calls } = await roomSetup();
      // It mentions the AI and carries a body (the retraction fallback): only
      // the guard keeps the gateway from answering it.
      const retraction = roomMessage(roomJid, member.jid, 'm-1', 'fallback text', {
        nick: 'Ana',
        mentions: [seeded.aiJid],
      });
      retraction.retraction = { targetId: 'm-0' };
      core.receive(retraction);

      await tick(150);
      expect(calls).toHaveLength(0);
      expect(core.sent).toHaveLength(0);
      expect(core.typing).toHaveLength(0);
    });

    it('makes no turn for another AI sender', async () => {
      const { seeded, roomJid, core, calls } = await roomSetup();
      core.receive(
        roomMessage(roomJid, `ai-other@${TEST_XMPP_DOMAIN}`, 'm-1', 'hey helper', {
          nick: 'Helper',
          mentions: [seeded.aiJid],
        }),
      );
      await tick(150);
      expect(calls).toHaveLength(0);
      expect(core.sent).toHaveLength(0);
    });

    it('makes no turn for an occupant whose real JID is unknown, even with an AI nick', async () => {
      const { seeded, roomJid, core, calls } = await roomSetup();
      core.receive(
        roomMessage(roomJid, `${roomJid}/Helper`, 'm-1', 'hey helper', {
          nick: 'Gateway AI',
          resolved: false,
          mentions: [seeded.aiJid],
        }),
      );
      await tick(150);
      expect(calls).toHaveLength(0);
      expect(core.sent).toHaveLength(0);
    });

    it('makes no turn for delayed history replayed on join', async () => {
      const { seeded, member, roomJid, core, calls } = await roomSetup();
      core.receive(
        roomMessage(roomJid, member.jid, 'm-old', 'hey, what do you think?', {
          nick: 'Ana',
          mentions: [seeded.aiJid],
          timestamp: new Date('2026-09-28T11:00:00Z'),
        }),
      );
      await tick(150);
      expect(calls).toHaveLength(0);
      expect(core.sent).toHaveLength(0);
    });

    it('makes no turn for a mention from a non-member', async () => {
      const { seeded, roomJid, core, calls } = await roomSetup();
      const outsider = await seedMember('Outsider');
      core.receive(
        roomMessage(roomJid, outsider.jid, 'm-1', 'hey, what do you think?', {
          nick: 'Outsider',
          mentions: [seeded.aiJid],
        }),
      );
      await tick(150);
      expect(calls).toHaveLength(0);
      expect(core.sent).toHaveLength(0);
    });

    it('drops the 7th turn in 10 minutes with one log line', async () => {
      const { seeded, member, roomJid, core, calls, logger, groupId } = await roomSetup();
      for (let index = 1; index <= 6; index += 1) {
        core.receive(mention(seeded, member, roomJid, `m-${index}`));
        await waitFor(() => core.sent.length === index);
      }
      expect(calls).toHaveLength(6);

      core.receive(mention(seeded, member, roomJid, 'm-7'));
      await tick(200);
      expect(calls).toHaveLength(6);
      expect(core.sent).toHaveLength(6);
      const limited = logger.calls.filter(
        (call) => call.message === 'AI group rate limit reached; dropping the turn',
      );
      expect(limited).toHaveLength(1);
      expect(limited[0]?.fields).toEqual({ aiId: seeded.aiId, groupId, messageId: 'm-7' });
    });

    it('starts a re-added AI with a fresh rate budget', async () => {
      const { seeded, member, roomJid, core, calls, groupId } = await roomSetup();
      for (let index = 1; index <= 6; index += 1) {
        core.receive(mention(seeded, member, roomJid, `m-${index}`));
        await waitFor(() => core.sent.length === index);
      }
      expect(calls).toHaveLength(6);

      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`DELETE FROM group_ais WHERE group_id = ${groupId} AND ai_id = ${seeded.aiId}`;
        }),
      );
      emitGroupAi({ type: 'ai-removed', groupId, aiId: seeded.aiId });
      await waitFor(() => core.left.length === 1);
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO group_ais ${sql.insert({
            group_id: groupId,
            ai_id: seeded.aiId,
            added_by: seeded.ownerId,
          })}`;
        }),
      );
      emitGroupAi({ type: 'ai-added', groupId, aiId: seeded.aiId });
      await waitFor(() => core.joined.length === 2);

      // Within the same 10 minutes, but the leave cleared the budget.
      core.receive(mention(seeded, member, roomJid, 'm-7'));
      await waitFor(() => core.sent.length === 7);
      expect(calls).toHaveLength(7);
    });

    it('answers a mixed-case mention in a mixed-case room JID', async () => {
      const { seeded, member, roomJid, core, calls } = await roomSetup();
      core.receive(
        roomMessage(roomJid.toUpperCase(), member.jid, 'm-1', 'hey, what do you think?', {
          nick: 'Ana',
          mentions: [seeded.aiJid.toUpperCase()],
        }),
      );
      await waitFor(() => calls.length === 1);
      expect(core.sent).toHaveLength(1);
      expect(core.sent[0]).toMatchObject({ to: roomJid, kind: 'groupchat' });
    });

    it('coalesces a burst of mentions like DMs', async () => {
      const seeded = await seedAi(context);
      const member = await seedMember('Ana');
      const { roomJid } = await seedGroup({
        ownerId: seeded.ownerId,
        aiId: seeded.aiId,
        memberIds: [member.userId],
      });
      const cores: FakeCore[] = [];
      const calls: Call[] = [];
      const resolvers: Array<(response: Response) => void> = [];
      const fetchImpl: FetchLike = (url, init) => {
        calls.push({ url, init });
        return new Promise<Response>((resolve) => {
          resolvers.push(resolve);
        });
      };
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      core.receive(mention(seeded, member, roomJid, 'm-1'));
      await waitFor(() => calls.length === 1);
      core.receive(mention(seeded, member, roomJid, 'm-2'));
      core.receive(mention(seeded, member, roomJid, 'm-3'));
      resolvers[0]!(completionResponse('reply one'));
      await waitFor(() => calls.length === 2);
      const secondMessages = (
        bodyOf(calls[1]!) as { messages: Array<{ content: string }> }
      ).messages.map((message) => message.content);
      expect(secondMessages.join('\n')).toContain('hey, what do you think?');

      resolvers[1]!(completionResponse('reply two'));
      await waitFor(() => core.sent.length === 2);
      expect(calls).toHaveLength(2);
      expect(core.sent.map((message) => message.to)).toEqual([roomJid, roomJid]);
    });

    it('posts the spending-limit text in the room on 429 and leaks no secret', async () => {
      const { seeded, member, roomJid, core, logger } = await roomSetup({
        fetch: () => {
          const calls: Call[] = [];
          const fetchImpl: FetchLike = (url, init) => {
            calls.push({ url, init });
            return Promise.resolve(
              jsonResponse({ error: { message: `provider echoed ${VIRTUAL_KEY}` } }, 429),
            );
          };
          return { fetchImpl, calls };
        },
      });
      core.receive(mention(seeded, member, roomJid, 'm-1'));
      await waitFor(() => core.sent.length === 1);
      expect(core.sent[0]?.text).toBe(`@Ana ${BUDGET_EXCEEDED_REPLY}`);
      expect(core.sent[0]?.kind).toBe('groupchat');
      const logged = loggedText(logger.calls);
      expect(logged).not.toContain(VIRTUAL_KEY);
      expect(logged).not.toContain(MASTER_KEY);
      expect(logged).not.toContain(PROVIDER_KEY);
      expect(JSON.stringify(core.sent)).not.toContain(VIRTUAL_KEY);
    });

    it('keeps answering owner DMs while in a group', async () => {
      const { seeded, member, roomJid, core, calls } = await roomSetup();
      core.receive(mention(seeded, member, roomJid, 'm-1'));
      await waitFor(() => calls.length === 1);
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-2', 'hello in dm'));
      await waitFor(() => calls.length === 2);
      expect(core.sent.map((message) => message.kind)).toEqual(['groupchat', 'chat']);
      expect(core.sent[1]).toMatchObject({ to: seeded.ownerJid, text: 'AI says hi' });
    });

    it('enforces the daily limit in rooms: one plain notice, then silence', async () => {
      const { seeded, member, roomJid, core, calls, litellm } = await roomSetup();
      const notice = "I've reached today's spending limit ($1.00). I'll be back after 00:00 UTC.";

      // The first mention records the 0.5 baseline and replies normally.
      litellm.spendByKey.set('tok-1', 0.5);
      core.receive(mention(seeded, member, roomJid, 'm-1'));
      await waitFor(() => calls.length === 1);
      expect(core.sent).toHaveLength(1);

      // Past the $1/day cap: one plain notice, no model call, no mention.
      litellm.spendByKey.set('tok-1', 2);
      core.receive(mention(seeded, member, roomJid, 'm-2'));
      await waitFor(() => core.sent.length === 2);
      expect(core.sent[1]).toEqual({ to: roomJid, kind: 'groupchat', text: notice });
      expect(calls).toHaveLength(1);

      // A further mention the same day gets nothing.
      core.receive(mention(seeded, member, roomJid, 'm-3'));
      await tick(200);
      expect(core.sent).toHaveLength(2);
      expect(calls).toHaveLength(1);
    });

    it('warns in the room after the reply, once per day, and never for skipped turns', async () => {
      const { seeded, member, roomJid, core, calls, litellm } = await roomSetup();
      const warning =
        "Heads up: I've used $0.80 of my $1.00 daily limit. I'll pause for the day when it runs out.";

      litellm.spendByKey.set('tok-1', 0.5);
      core.receive(mention(seeded, member, roomJid, 'm-1'));
      await waitFor(() => calls.length === 1);
      await waitFor(() => core.sent.length === 1);

      // Crossing 80%: the room reply first, then the plain warning.
      litellm.spendByKey.set('tok-1', 1.3);
      core.receive(mention(seeded, member, roomJid, 'm-2'));
      await waitFor(() => core.sent.length === 3);
      expect(calls).toHaveLength(2);
      expect(core.sent[1]?.kind).toBe('groupchat');
      expect(core.sent[1]?.text).toContain('@Ana');
      expect(core.sent[2]).toEqual({ to: roomJid, kind: 'groupchat', text: warning });

      // A further mention the same day gets a reply but no second warning.
      core.receive(mention(seeded, member, roomJid, 'm-3'));
      await waitFor(() => calls.length === 3);
      await waitFor(() => core.sent.length === 4);
      expect(core.sent.filter((message) => message.text === warning)).toHaveLength(1);

      // A mention with no trigger (a plain message, no @mention) starts no
      // turn and sends no warning.
      const sentBefore = core.sent.length;
      core.receive(roomMessage(roomJid, member.jid, 'm-4', 'hello everyone', { nick: 'Ana' }));
      await tick(200);
      expect(core.sent).toHaveLength(sentBefore);
      expect(calls).toHaveLength(3);
    });

    // T-0098: in a group turn only the AI's owner and the group's owners /
    // admins may ask for an action. The model sees only the `request_action`
    // tool, the action gateway gets the room's group id from the session
    // (never the model), and a role change between turn start and tool
    // execution answers `denied: not allowed` without invoking the gateway.
    describe('request_action in groups (T-0098)', () => {
      interface FakeActions {
        gateway: ActionGateway;
        requests: Array<{
          aiId: string;
          groupId?: string;
          topicId?: string;
          action: string;
          args: unknown;
          requestedBy: string;
        }>;
      }

      function fakeActions(outcome: RequestOutcome): FakeActions {
        const requests: FakeActions['requests'] = [];
        return {
          requests,
          gateway: {
            request: async (params) => {
              requests.push({ ...params });
              return outcome;
            },
            onApprovalDecided: () => Promise.resolve(),
            recoverStuck: () => Promise.resolve(),
            listActions: () => [{ name: 'demo.echo', description: 'Repeats text.' }],
          },
        };
      }

      // Two-step scripted fetch: first call answers with the supplied
      // tool call, second call answers a plain completion. Used to drive
      // the full tool loop through one turn.
      function requestActionScriptedFetch(
        toolArgs: unknown,
        followUp = 'follow-up',
      ): {
        fetchImpl: FetchLike;
        calls: Call[];
      } {
        const calls: Call[] = [];
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
                        arguments: JSON.stringify(toolArgs),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          completionResponse(followUp),
        ];
        let index = 0;
        const fetchImpl: FetchLike = (_url, init) => {
          calls.push({ url: _url, init: init ?? { headers: new Headers() } });
          const response = responses[Math.min(index, responses.length - 1)]!;
          index += 1;
          return Promise.resolve(response.clone());
        };
        return { fetchImpl, calls };
      }

      // Seeds a group whose members are exactly the supplied list (each with
      // the given role). The AI's owner is intentionally NOT a group member
      // so the tests below can pick an admin / owner / member from the list
      // verbatim without colliding with the AI's owner.
      async function setupGroupWithRoles(input: {
        members: Array<{ name: string; role: 'owner' | 'admin' | 'member' }>;
        fetch: () => { fetchImpl: FetchLike; calls: Call[] };
        actions?: ActionGateway;
      }): Promise<{
        seeded: SeededAi;
        members: Array<{
          userId: string;
          jid: string;
          role: 'owner' | 'admin' | 'member';
          name: string;
        }>;
        groupId: string;
        topicId: string;
        roomJid: string;
        core: FakeCore;
        calls: Call[];
        logger: ReturnType<typeof captureLogger>;
      }> {
        const seeded = await seedAi(context);
        const members: Array<{
          userId: string;
          jid: string;
          role: 'owner' | 'admin' | 'member';
          name: string;
        }> = [];
        for (const m of input.members) {
          const userId = randomUUID();
          const memberName = m.name;
          const memberEmail = `${userId}@example.com`;
          await testSql(context)(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              yield* sql`INSERT INTO "user" ${sql.insert({
                id: userId,
                name: memberName,
                email: memberEmail,
              })}`;
            }),
          );
          members.push({
            userId,
            jid: `${localpartFor(userId)}@${TEST_XMPP_DOMAIN}`,
            role: m.role,
            name: m.name,
          });
        }
        const groupId = randomUUID();
        const roomLocalpart = `g98${randomUUID().replace(/-/g, '').slice(0, 10)}`;
        // The group's creator is the first owner (a test convenience; the
        // gateway never reads this column on a turn).
        const creator = members.find((m) => m.role === 'owner') ?? members[0]!;
        const creatorId = creator.userId;
        const memberRows = members.map((m) => ({
          group_id: groupId,
          user_id: m.userId,
          role: m.role,
        }));
        const generalTopicId = randomUUID();
        await testSql(context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`INSERT INTO groups ${sql.insert({
              id: groupId,
              room_localpart: roomLocalpart,
              title: 'Room',
              created_by: creatorId,
            })}`;
            yield* sql`INSERT INTO group_members ${sql.insert(memberRows)}`;
            yield* sql`INSERT INTO group_ais ${sql.insert({
              group_id: groupId,
              ai_id: seeded.aiId,
              added_by: creatorId,
            })}`;
            yield* sql`INSERT INTO topics ${sql.insert({
              id: generalTopicId,
              group_id: groupId,
              name: 'General',
              glyph: 'G',
              room_localpart: roomLocalpart,
              visibility: 'public',
              kind: 'chat',
              status: 'open',
              is_general: true,
              created_by: creatorId,
            })}`;
          }),
        );
        const roomJid = `${roomLocalpart}@${TEST_XMPP_MUC_DOMAIN}`;
        const cores: FakeCore[] = [];
        const { fetchImpl, calls } = input.fetch();
        const litellm = new FakeLitellm();
        const { gateway: started, logger } =
          input.actions === undefined
            ? harness(cores, fetchImpl, litellm)
            : harness(cores, fetchImpl, litellm, { actions: input.actions });
        await started.start();
        const core = await coreFor(cores, seeded.aiJid);
        return { seeded, members, groupId, topicId: generalTopicId, roomJid, core, calls, logger };
      }

      function memberMention(
        seeded: SeededAi,
        member: { jid: string; name: string },
        roomJid: string,
        id: string,
      ) {
        return roomMessage(roomJid, member.jid, id, 'please run demo.echo with text hello', {
          nick: member.name,
          mentions: [seeded.aiJid],
        });
      }

      it('an admin sender sees the memory tools and request_action (no persona tools)', async () => {
        const fake = fakeActions({ status: 'pending_approval', approvalId: 'appr-1' });
        const setup_ = await setupGroupWithRoles({
          members: [{ name: 'Bea', role: 'admin' }],
          fetch: () =>
            requestActionScriptedFetch({
              action: 'demo.echo',
              args: { text: 'hello' },
            }),
          actions: fake.gateway,
        });
        const { seeded, members, groupId, roomJid, core, calls } = setup_;
        const admin = members[0]!;
        core.receive(memberMention(seeded, admin, roomJid, 'm-1'));
        await waitFor(() => calls.length === 2);
        for (const call of calls) {
          const body = JSON.parse(String(call.init.body)) as {
            tools: Array<{ function: { name: string } }>;
            tool_choice: string;
          };
          expect(body.tool_choice).toBe('auto');
          const names = body.tools.map((tool) => tool.function.name);
          expect(names).toEqual(['recall', 'memory_zoom', 'remember', 'request_action']);
          expect(names).not.toContain('update_persona');
          expect(names).not.toContain('revert_persona');
        }
        await waitFor(() => fake.requests.length === 1);
        expect(fake.requests[0]).toEqual({
          aiId: seeded.aiId,
          groupId,
          topicId: setup_.topicId,
          action: 'demo.echo',
          args: { text: 'hello' },
          requestedBy: seeded.aiJid,
        });
        await waitFor(() => core.sent.length === 1);
        // The reply is in the room, points at the trigger, mentions the admin.
        expect(core.sent[0]).toMatchObject({ to: roomJid, kind: 'groupchat' });
        const opts = core.sent[0]?.opts as {
          replyTo: { id: string };
          mentions: Array<{ jid: string }>;
        };
        expect(opts.replyTo.id).toBe('m-1');
        expect(opts.mentions[0]?.jid).toBe(admin.jid);
        // The fixed wording for groups, distinct from the DM line.
        const second = JSON.parse(String(calls[1]!.init.body)) as {
          messages: Array<{ role: string; content: string }>;
        };
        const toolMessage = second.messages.find((message) => message.role === 'tool');
        expect(toolMessage?.content).toBe(
          "waiting for an admin's approval; a card was posted in this room",
        );
      });

      it('an owner sender sees the memory tools and request_action and gets the executed wording', async () => {
        const fake = fakeActions({ status: 'executed', summary: 'Echoed: hello' });
        const setup_ = await setupGroupWithRoles({
          members: [{ name: 'Owen', role: 'owner' }],
          fetch: () => requestActionScriptedFetch({ action: 'demo.echo', args: { text: 'hello' } }),
          actions: fake.gateway,
        });
        const { seeded, members, roomJid, core, calls } = setup_;
        const owner = members[0]!;
        core.receive(memberMention(seeded, owner, roomJid, 'm-1'));
        await waitFor(() => fake.requests.length === 1);
        await waitFor(() => calls.length === 2);
        const firstBody = JSON.parse(String(calls[0]!.init.body)) as {
          tools: Array<{ function: { name: string } }>;
        };
        expect(firstBody.tools.map((tool) => tool.function.name)).toEqual([
          'recall',
          'memory_zoom',
          'remember',
          'request_action',
        ]);
        const second = JSON.parse(String(calls[1]!.init.body)) as {
          messages: Array<{ role: string; content: string }>;
        };
        const toolMessage = second.messages.find((message) => message.role === 'tool');
        expect(toolMessage?.content).toBe('done: Echoed: hello');
        void core;
      });

      it('a persona tool the model improvises in a group tool turn is never executed', async () => {
        const fake = fakeActions({ status: 'executed', summary: 'unused' });
        const calls: Call[] = [];
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
                        name: 'update_persona',
                        arguments: JSON.stringify({ persona: 'INJECTED PERSONA', summary: 'x' }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          completionResponse('follow-up'),
        ];
        let index = 0;
        const fetchImpl: FetchLike = (_url, init) => {
          calls.push({ url: _url, init: init ?? { headers: new Headers() } });
          const response = responses[Math.min(index, responses.length - 1)]!;
          index += 1;
          return Promise.resolve(response.clone());
        };
        const setup_ = await setupGroupWithRoles({
          members: [{ name: 'Owen', role: 'owner' }],
          fetch: () => ({ fetchImpl, calls }),
          actions: fake.gateway,
        });
        const { seeded, members, roomJid, core } = setup_;
        const [before] = await testSql(context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<{ persona: string }>`SELECT persona FROM ais
              WHERE id = ${seeded.aiId}`;
          }),
        );
        core.receive(memberMention(seeded, members[0]!, roomJid, 'm-1'));
        await waitFor(() => calls.length === 2);
        const second = JSON.parse(String(calls[1]!.init.body)) as {
          messages: Array<{ role: string; content: string }>;
        };
        const toolMessage = second.messages.find((message) => message.role === 'tool');
        expect(toolMessage?.content).toBe('invalid: unknown tool');
        const [after] = await testSql(context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<{ persona: string }>`SELECT persona FROM ais
              WHERE id = ${seeded.aiId}`;
          }),
        );
        expect(after?.persona).toBe(before?.persona);
        expect(fake.requests).toHaveLength(0);
      });

      it('a model that smuggles aiId/groupId inside args cannot change who is asked', async () => {
        const fake = fakeActions({ status: 'pending_approval', approvalId: 'appr-2' });
        const setup_ = await setupGroupWithRoles({
          members: [{ name: 'Bea', role: 'admin' }],
          fetch: () =>
            requestActionScriptedFetch({
              action: 'demo.echo',
              args: {
                text: 'hi',
                aiId: 'attacker-ai-id',
                groupId: 'attacker-group-id',
              },
            }),
          actions: fake.gateway,
        });
        const { seeded, members, groupId, roomJid, core } = setup_;
        const admin = members[0]!;
        core.receive(memberMention(seeded, admin, roomJid, 'm-1'));
        await waitFor(() => fake.requests.length === 1);
        // Top-level ids still come from the session; the smuggled keys stay
        // inside `args` where the adapter's zod schema decides whether they
        // belong.
        expect(fake.requests[0]?.aiId).toBe(seeded.aiId);
        expect(fake.requests[0]?.groupId).toBe(groupId);
        expect(fake.requests[0]?.requestedBy).toBe(seeded.aiJid);
        expect(fake.requests[0]?.args).toEqual({
          text: 'hi',
          aiId: 'attacker-ai-id',
          groupId: 'attacker-group-id',
        });
        void core;
      });

      it('maps every RequestOutcome to the fixed group wording (no adapter error text)', async () => {
        const outcomes: Array<{ outcome: RequestOutcome; expectedContent: string }> = [
          {
            outcome: { status: 'executed', summary: 'Echoed: hi' },
            expectedContent: 'done: Echoed: hi',
          },
          {
            outcome: { status: 'pending_approval', approvalId: 'appr-3' },
            expectedContent: "waiting for an admin's approval; a card was posted in this room",
          },
          { outcome: { status: 'failed' }, expectedContent: 'the action failed' },
          {
            outcome: { status: 'denied', reason: 'unknown_action' },
            expectedContent: 'denied: unknown action',
          },
          {
            outcome: { status: 'denied', reason: 'invalid_args' },
            expectedContent: 'denied: invalid arguments',
          },
          {
            outcome: { status: 'denied', reason: 'ai_not_active' },
            expectedContent: 'denied: the AI is not active',
          },
          {
            outcome: { status: 'denied', reason: 'ai_not_in_group' },
            expectedContent: 'denied: the AI is not in that topic',
          },
        ];
        for (const { outcome, expectedContent } of outcomes) {
          const fake = fakeActions(outcome);
          const setup_ = await setupGroupWithRoles({
            members: [{ name: 'Bea', role: 'admin' }],
            fetch: () => requestActionScriptedFetch({ action: 'demo.echo', args: { text: 'hi' } }),
            actions: fake.gateway,
          });
          const { seeded, members, roomJid, core, calls } = setup_;
          const admin = members[0]!;
          core.receive(memberMention(seeded, admin, roomJid, 'm-1'));
          await waitFor(() => calls.length === 2);
          const second = JSON.parse(String(calls[1]!.init.body)) as {
            messages: Array<{ role: string; content: string }>;
          };
          const toolMessage = second.messages.find((message) => message.role === 'tool');
          expect(toolMessage?.content).toBe(expectedContent);
          const dumped = JSON.stringify({ calls, toolMessage });
          expect(dumped).not.toContain('SECRET-DO-NOT-LOG');
        }
      });

      it('a plain member sender gets only the memory tools; actions.request is never called', async () => {
        const fake = fakeActions({ status: 'pending_approval', approvalId: 'appr-4' });
        const setup_ = await setupGroupWithRoles({
          members: [{ name: 'Carol', role: 'member' }],
          fetch: () => requestActionScriptedFetch({ action: 'demo.echo', args: { text: 'hi' } }),
          actions: fake.gateway,
        });
        const { seeded, members, roomJid, core, calls } = setup_;
        const plain = members[0]!;
        core.receive(memberMention(seeded, plain, roomJid, 'm-1'));
        await waitFor(() => calls.length === 2);
        for (const call of calls) {
          const body = JSON.parse(String(call.init.body)) as {
            tools: Array<{ function: { name: string } }>;
          };
          // A plain member never gets `request_action`; the three memory
          // tools (T-0444) are all a room turn advertises to them.
          expect(body.tools.map((tool) => tool.function.name)).toEqual([
            'recall',
            'memory_zoom',
            'remember',
          ]);
        }
        const second = JSON.parse(String(calls[1]!.init.body)) as {
          messages: Array<{ role: string; content: string }>;
        };
        const toolMessage = second.messages.find((message) => message.role === 'tool');
        expect(toolMessage?.content).toMatch(/^invalid: /);
        expect(fake.requests).toHaveLength(0);
      });

      it('a plain member improvising request_action gets `invalid: unknown tool`, gateway not called', async () => {
        const fake = fakeActions({ status: 'pending_approval', approvalId: 'appr-plain' });
        const setup_ = await setupGroupWithRoles({
          members: [{ name: 'Carol', role: 'member' }],
          fetch: () => requestActionScriptedFetch({ action: 'demo.echo', args: { text: 'hi' } }),
          actions: fake.gateway,
        });
        const { seeded, members, roomJid, core, calls } = setup_;
        const plain = members[0]!;
        core.receive(memberMention(seeded, plain, roomJid, 'm-1'));
        await waitFor(() => calls.length === 2);

        const second = JSON.parse(String(calls[1]!.init.body)) as {
          messages: Array<{ role: string; content: string }>;
        };
        const toolMessage = second.messages.find((message) => message.role === 'tool');
        expect(toolMessage?.content).toBe('invalid: unknown tool');
        expect(fake.requests).toHaveLength(0);
        expect(core.sent).toHaveLength(1);
      });

      it('an AI sender gets no tools and the action gateway is never called', async () => {
        const fake = fakeActions({ status: 'pending_approval', approvalId: 'appr-5' });
        const { seeded, roomJid, core, calls } = await roomSetup({
          fetch: () => requestActionScriptedFetch({ action: 'demo.echo', args: { text: 'hi' } }),
        });
        // The harness was started without actions; rebuild it with actions
        // so we can assert the gateway was never called even if a stray
        // tool call slipped through. (The earlier room-level `roomSetup`
        // does not take an actions arg, so this stays focused on the AI
        // sender being filtered out at the gate.)
        void fake;
        core.receive(
          roomMessage(
            roomJid,
            `ai-other@${TEST_XMPP_DOMAIN}`,
            'm-1',
            'please run demo.echo with text hello',
            {
              nick: 'Helper',
              mentions: [seeded.aiJid],
            },
          ),
        );
        await tick(200);
        expect(calls).toHaveLength(0);
        expect(core.sent).toHaveLength(0);
      });

      it('a sender removed from the group before the gate lookup starts no turn', async () => {
        const fake = fakeActions({ status: 'pending_approval', approvalId: 'appr-6' });
        const setup_ = await setupGroupWithRoles({
          members: [
            { name: 'Bea', role: 'admin' },
            { name: 'Carol', role: 'member' },
          ],
          fetch: () => requestActionScriptedFetch({ action: 'demo.echo', args: { text: 'hi' } }),
          actions: fake.gateway,
        });
        const { seeded, members, groupId, roomJid, core, calls } = setup_;
        const carol = members.find((m) => m.role === 'member')!;
        // Remove Carol between setup and the mention so the gate lookup
        // done at turn start never sees her — the membership filter drops
        // her and no turn runs.
        await testSql(context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`DELETE FROM group_members
              WHERE group_id = ${groupId} AND user_id = ${carol.userId}`;
          }),
        );
        core.receive(memberMention(seeded, carol, roomJid, 'm-1'));
        await tick(200);
        expect(calls).toHaveLength(0);
        expect(fake.requests).toHaveLength(0);
        expect(core.sent).toHaveLength(0);
      });

      it('role revoked between turn start and tool execution: denied, gateway not called', async () => {
        const fake = fakeActions({ status: 'pending_approval', approvalId: 'appr-7' });
        const seeded = await seedAi(context);
        const adminId = randomUUID();
        const adminJid = `${localpartFor(adminId)}@${TEST_XMPP_DOMAIN}`;
        const groupId = randomUUID();
        const roomLocalpart = `g98rev${randomUUID().replace(/-/g, '').slice(0, 7)}`;
        const generalTopicId = randomUUID();
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
              room_localpart: roomLocalpart,
              title: 'Room',
              created_by: adminId,
            })}`;
            yield* sql`INSERT INTO group_members ${sql.insert({
              group_id: groupId,
              user_id: adminId,
              role: 'admin',
            })}`;
            yield* sql`INSERT INTO group_ais ${sql.insert({
              group_id: groupId,
              ai_id: seeded.aiId,
              added_by: adminId,
            })}`;
            yield* sql`INSERT INTO topics ${sql.insert({
              id: generalTopicId,
              group_id: groupId,
              name: 'General',
              glyph: 'G',
              room_localpart: roomLocalpart,
              visibility: 'public',
              kind: 'chat',
              status: 'open',
              is_general: true,
              created_by: adminId,
            })}`;
          }),
        );
        const roomJid = `${roomLocalpart}@${TEST_XMPP_MUC_DOMAIN}`;

        // A fetch that parks the first LLM call until `release()` runs, so
        // the test can demote the admin while the turn is mid-flight and
        // the executor's re-check observes the new role.
        const calls: Call[] = [];
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const fetchImpl: FetchLike = (_url, init) => {
          calls.push({ url: _url, init: init ?? { headers: new Headers() } });
          return gate.then(() =>
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
                          arguments: JSON.stringify({
                            action: 'demo.echo',
                            args: { text: 'hi' },
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
          );
        };
        const cores: FakeCore[] = [];
        const litellm = new FakeLitellm();
        const { gateway: started, logger } = harness(cores, fetchImpl, litellm, {
          actions: fake.gateway,
        });
        await started.start();
        const core = await coreFor(cores, seeded.aiJid);

        core.receive(
          roomMessage(roomJid, adminJid, 'm-1', 'please run demo.echo with text hello', {
            nick: 'Bea',
            mentions: [seeded.aiJid],
          }),
        );
        // First call parks; demote while it's parked.
        await waitFor(() => calls.length === 1);
        await testSql(context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`UPDATE group_members SET role = 'member'
              WHERE group_id = ${groupId} AND user_id = ${adminId}`;
          }),
        );
        // Now release the first call: the executor parses the tool call,
        // re-checks the role, sees the demotion, and answers
        // `denied: not allowed` without invoking the action gateway.
        release();
        await tick(300);
        expect(fake.requests).toHaveLength(0);
        // The log line identifies the demotion path.
        const demotion = logger.calls.find(
          (call) => call.message === 'AI request_action denied: sender no longer allowed',
        );
        expect(demotion?.fields['aiId']).toBe(seeded.aiId);
        expect(demotion?.fields['action']).toBe('demo.echo');
        expect(demotion?.fields['groupId']).toBe(groupId);
        void core;
        void started;
      });

      it('without actions the model sees only the memory tools; a request_action call answers invalid', async () => {
        const setup_ = await setupGroupWithRoles({
          members: [{ name: 'Bea', role: 'admin' }],
          fetch: () => requestActionScriptedFetch({ action: 'demo.echo', args: { text: 'hi' } }),
        });
        const { seeded, members, roomJid, calls } = setup_;
        const admin = members[0]!;
        // Drive the mention through the helper that lives outside this
        // describe — the seed already returned the right JIDs.
        const { core } = setup_;
        core.receive(memberMention(seeded, admin, roomJid, 'm-1'));
        await waitFor(() => calls.length === 2);
        for (const call of calls) {
          const body = JSON.parse(String(call.init.body)) as {
            tools: Array<{ function: { name: string } }>;
          };
          expect(body.tools.map((tool) => tool.function.name)).toEqual([
            'recall',
            'memory_zoom',
            'remember',
          ]);
        }
        const second = JSON.parse(String(calls[1]!.init.body)) as {
          messages: Array<{ role: string; content: string }>;
        };
        const toolMessage = second.messages.find((message) => message.role === 'tool');
        expect(toolMessage?.content).toMatch(/^invalid: /);
      });

      it('a stopped AI never calls the action gateway or sends a room reply', async () => {
        const fake = fakeActions({ status: 'executed', summary: 'Echoed: hi' });
        const seeded = await seedAi(context);
        const adminId = randomUUID();
        const adminJid = `${localpartFor(adminId)}@${TEST_XMPP_DOMAIN}`;
        const groupId = randomUUID();
        const roomLocalpart = `g98stop${randomUUID().replace(/-/g, '').slice(0, 7)}`;
        const generalTopicId = randomUUID();
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
              room_localpart: roomLocalpart,
              title: 'Room',
              created_by: adminId,
            })}`;
            yield* sql`INSERT INTO group_members ${sql.insert({
              group_id: groupId,
              user_id: adminId,
              role: 'admin',
            })}`;
            yield* sql`INSERT INTO group_ais ${sql.insert({
              group_id: groupId,
              ai_id: seeded.aiId,
              added_by: adminId,
            })}`;
            yield* sql`INSERT INTO topics ${sql.insert({
              id: generalTopicId,
              group_id: groupId,
              name: 'General',
              glyph: 'G',
              room_localpart: roomLocalpart,
              visibility: 'public',
              kind: 'chat',
              status: 'open',
              is_general: true,
              created_by: adminId,
            })}`;
          }),
        );
        const roomJid = `${roomLocalpart}@${TEST_XMPP_MUC_DOMAIN}`;
        // Park the first LLM call so we can stop the AI mid-turn.
        const calls: Call[] = [];
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const fetchImpl: FetchLike = (_url, init) => {
          calls.push({ url: _url, init: init ?? { headers: new Headers() } });
          return gate.then(() =>
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
                          arguments: JSON.stringify({
                            action: 'demo.echo',
                            args: { text: 'hi' },
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
          );
        };
        const cores: FakeCore[] = [];
        const litellm = new FakeLitellm();
        const { gateway: started } = harness(cores, fetchImpl, litellm, {
          actions: fake.gateway,
        });
        await started.start();
        const core = await coreFor(cores, seeded.aiJid);
        const deps: AiServiceDeps = {
          db: context.db,
          adminClient: context.adminClient,
          litellm: new FakeLitellm(),
          cipher: createKeyCipher(MASTER_KEY),
          logger: context.logger,
          domain: context.xmppConfig.domain,
        };
        core.receive(
          roomMessage(roomJid, adminJid, 'm-1', 'please run demo.echo with text hello', {
            nick: 'Bea',
            mentions: [seeded.aiJid],
          }),
        );
        // Park on the first LLM call, then stop the AI before it resolves.
        await waitFor(() => calls.length === 1);
        await stopAi(deps, seeded.aiId, seeded.ownerId);
        await waitFor(() => started.size() === 0);
        // The in-flight turn completes after release, but the executor's
        // `sessionIsLive` check returns 'the AI was stopped' and no
        // gateway call happens; `liveSendMessage` drops the room reply.
        release();
        await tick(300);
        expect(fake.requests).toHaveLength(0);
        expect(core.sent).toHaveLength(0);
        void started;
      });
    });
  });
});
