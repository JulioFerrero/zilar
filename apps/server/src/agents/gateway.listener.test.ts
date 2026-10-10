import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { emitGroupAi } from '../groups/events';
import { localpartFor } from '../xmpp/provisioning';
import { stopAi, type AiServiceDeps } from '../ais/service';
import { type AgentGateway } from './gateway';
import { type CompleteChatInput } from './reply';
import {
  captureLogger,
  completionResponse,
  createGatewayHelpers,
  FakeCore,
  FakeLitellm,
  incoming,
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

  describe('listener (T-0475)', () => {
    const NOW = new Date('2026-09-28T12:00:00Z');
    const LISTENER_VIRTUAL_KEY = 'sk-listener-key-do-not-leak';

    function listenerScores(aiId: string, score: number): string {
      return JSON.stringify({ scores: { [aiId]: score }, reason: 'one line', message_ids: [] });
    }

    async function seedMember(name: string): Promise<{ userId: string; jid: string }> {
      const userId = randomUUID();
      const memberName = name;
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
      return { userId, jid: `${localpartFor(userId)}@${TEST_XMPP_DOMAIN}` };
    }

    async function seedGroup(input: {
      ownerId: string;
      memberIds?: string[];
      listenerEnabled?: boolean;
      eagerness?: 'quiet' | 'normal' | 'eager';
    }): Promise<{ groupId: string; roomJid: string }> {
      const groupId = randomUUID();
      const roomLocalpart = `ltest${randomUUID().replace(/-/g, '').slice(0, 10)}`;
      const generalTopicId = randomUUID();
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
            ...(input.listenerEnabled === undefined
              ? {}
              : { listener_enabled: input.listenerEnabled }),
            ...(input.eagerness === undefined ? {} : { listener_eagerness: input.eagerness }),
          })}`;
          yield* sql`INSERT INTO group_members ${sql.insert(members)}`;
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
            created_by: input.ownerId,
          })}`;
        }),
      );
      return { groupId, roomJid: `${roomLocalpart}@${TEST_XMPP_MUC_DOMAIN}` };
    }

    async function addAiToGroup(groupId: string, ownerId: string, aiId: string): Promise<void> {
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO group_ais ${sql.insert({
            group_id: groupId,
            ai_id: aiId,
            added_by: ownerId,
          })}`;
        }),
      );
    }

    function roomMessage(
      roomJid: string,
      fromJid: string,
      id: string,
      body: string,
      options: { nick?: string; mentions?: string[] } = {},
    ): ChatMessage {
      return {
        id,
        chatJid: roomJid,
        kind: 'groupchat',
        fromJid,
        fromResolved: true,
        ...(options.nick === undefined ? {} : { fromNick: options.nick }),
        body,
        ...(options.mentions === undefined
          ? {}
          : { mentions: options.mentions.map((jid) => ({ jid })) }),
        timestamp: NOW,
        outgoing: false,
      };
    }

    function mention(seeded: SeededAi, member: { jid: string }, roomJid: string, id: string) {
      return roomMessage(roomJid, member.jid, id, 'hey, what do you think?', {
        nick: 'Ana',
        mentions: [seeded.aiJid],
      });
    }

    interface ListenerSetup {
      seeded: SeededAi;
      extras: SeededAi[];
      member: { userId: string; jid: string };
      groupId: string;
      roomJid: string;
      core: FakeCore;
      cores: FakeCore[];
      calls: Call[];
      listenerCalls: CompleteChatInput[];
      litellm: FakeLitellm;
      started: AgentGateway;
      logger: ReturnType<typeof captureLogger>;
    }

    async function listenerSetup(
      input: {
        listenerEnabled?: boolean;
        eagerness?: 'quiet' | 'normal' | 'eager';
        aiCount?: number;
        quietMs?: number;
        everyN?: number;
        listener?: boolean;
        complete?: (aiId: string) => (call: CompleteChatInput) => Promise<string>;
        /** T-0481: display names, one per seeded AI (first is `seeded`). */
        names?: string[];
        /** T-0481: override the AI completion fetch. */
        fetch?: () => { fetchImpl: FetchLike; calls: Call[] };
        /** T-0481: action gateway, so a handoff turn's tool list can be checked. */
        actions?: ActionGateway;
        /** T-0482: fixed clock, so a seeded daily-spend baseline matches the
         * day the gateway reads. */
        now?: () => Date;
      } = {},
    ): Promise<ListenerSetup> {
      const seeded = await seedAi(
        context,
        input.names?.[0] === undefined ? {} : { name: input.names[0] },
      );
      const member = await seedMember('Ana');
      const { groupId, roomJid } = await seedGroup({
        ownerId: seeded.ownerId,
        memberIds: [member.userId],
        listenerEnabled: input.listenerEnabled ?? true,
        ...(input.eagerness === undefined ? {} : { eagerness: input.eagerness }),
      });
      await addAiToGroup(groupId, seeded.ownerId, seeded.aiId);
      const extras: SeededAi[] = [];
      for (let index = 1; index < (input.aiCount ?? 1); index += 1) {
        const name = input.names?.[index];
        const extra = await seedAi(context, name === undefined ? {} : { name });
        await addAiToGroup(groupId, extra.ownerId, extra.aiId);
        extras.push(extra);
      }
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = (input.fetch ?? completionFetch)();
      const litellm = new FakeLitellm();
      const listenerCalls: CompleteChatInput[] = [];
      const complete =
        input.complete?.(seeded.aiId) ??
        (async (call: CompleteChatInput) => {
          listenerCalls.push(call);
          return listenerScores(seeded.aiId, 0.9);
        });
      const listenerConfig =
        input.listener === false
          ? undefined
          : {
              model: 'listener-model',
              virtualKey: LISTENER_VIRTUAL_KEY,
              complete,
              quietMs: input.quietMs ?? 5,
              everyN: input.everyN ?? 12,
            };
      const { gateway: started, logger } = harness(cores, fetchImpl, litellm, {
        ...(listenerConfig === undefined ? {} : { listener: listenerConfig }),
        ...(input.actions === undefined ? {} : { actions: input.actions }),
        ...(input.now === undefined ? {} : { now: input.now }),
      });
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);
      return {
        seeded,
        extras,
        member,
        groupId,
        roomJid,
        core,
        cores,
        calls,
        listenerCalls,
        litellm,
        started,
        logger,
      };
    }

    function aiServiceDeps(litellm: FakeLitellm): AiServiceDeps {
      return {
        db: context.db,
        adminClient: context.adminClient,
        litellm,
        cipher: createKeyCipher(MASTER_KEY),
        logger: context.logger,
        domain: context.xmppConfig.domain,
      };
    }

    it('wakes nobody without a listener dep (today behaviour)', async () => {
      const { member, roomJid, core, calls } = await listenerSetup({ listener: false });
      core.receive(roomMessage(roomJid, member.jid, 'm-1', 'hello there', { nick: 'Ana' }));
      await tick(40);
      expect(calls).toHaveLength(0);
      expect(core.sent).toHaveLength(0);
    });

    it('does nothing while the group switch is off', async () => {
      const { member, roomJid, core, calls, listenerCalls } = await listenerSetup({
        listenerEnabled: false,
      });
      core.receive(roomMessage(roomJid, member.jid, 'm-1', 'hello there', { nick: 'Ana' }));
      await tick(40);
      expect(listenerCalls).toHaveLength(0);
      expect(calls).toHaveLength(0);
      expect(core.sent).toHaveLength(0);
    });

    it('wakes the scored AI with a line and a normal turn after the quiet window', async () => {
      const { seeded, member, roomJid, core, calls, listenerCalls } = await listenerSetup({
        quietMs: 10,
      });
      const message = roomMessage(roomJid, member.jid, 'm-1', 'no mention here', { nick: 'Ana' });
      core.receive(message);

      await waitFor(() => listenerCalls.length === 1);
      await waitFor(() => calls.length === 1);
      expect(listenerCalls[0]?.model).toBe('listener-model');
      expect(listenerCalls[0]?.virtualKey).toBe(LISTENER_VIRTUAL_KEY);
      await waitFor(() => core.sent.length >= 1);
      expect(core.sent[0]?.text).toBe('Gateway AI is looking at this');
      // The listener turn is a normal turn: the model sees the human message.
      expect(bodyOf(calls[0]!).messages.at(-1)).toEqual({
        role: 'user',
        content: 'Ana: no mention here',
      });
      expect(seeded.aiId).toBeTruthy();
    });

    it('records a message once for two AIs and wakes only the scored one', async () => {
      const { seeded, extras, member, roomJid, core, cores, calls, listenerCalls } =
        await listenerSetup({ aiCount: 2, quietMs: 10 });
      const secondCore = await coreFor(cores, extras[0]!.aiJid);
      const message = roomMessage(roomJid, member.jid, 'm-1', 'no mention here', { nick: 'Ana' });
      core.receive(message);
      secondCore.receive(message);

      await waitFor(() => listenerCalls.length === 1);
      await tick(30);
      expect(listenerCalls).toHaveLength(1);
      await waitFor(() => calls.length === 1);
      expect(core.sent[0]?.text).toBe('Gateway AI is looking at this');
      expect(secondCore.sent).toHaveLength(0);
      expect(seeded.aiId).not.toBe(extras[0]!.aiId);
    });

    it('fires at everyN without waiting for quiet', async () => {
      const { member, roomJid, core, calls, listenerCalls } = await listenerSetup({
        quietMs: 60_000,
        everyN: 3,
      });
      core.receive(roomMessage(roomJid, member.jid, 'm-1', 'one', { nick: 'Ana' }));
      core.receive(roomMessage(roomJid, member.jid, 'm-2', 'two', { nick: 'Ana' }));
      core.receive(roomMessage(roomJid, member.jid, 'm-3', 'three', { nick: 'Ana' }));

      await waitFor(() => listenerCalls.length === 1);
      await waitFor(() => calls.length === 1);
      expect(core.sent[0]?.text).toBe('Gateway AI is looking at this');
    });

    it('leaves a mention to the mention path and never scores it', async () => {
      const { seeded, member, roomJid, core, calls, listenerCalls } = await listenerSetup({
        quietMs: 10,
      });
      core.receive(mention(seeded, member, roomJid, 'm-1'));

      await waitFor(() => calls.length === 1);
      await tick(40);
      expect(listenerCalls).toHaveLength(0);
      expect(core.sent[0]?.text).toContain('AI says hi');
    });

    it('drops a scoring result when a newer human message arrives', async () => {
      let completeCalls = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { seeded, member, roomJid, core, calls } = await listenerSetup({
        quietMs: 30,
        complete: (aiId) => async () => {
          completeCalls += 1;
          await gate;
          return listenerScores(aiId, 0.9);
        },
      });
      core.receive(roomMessage(roomJid, member.jid, 'm-1', 'no mention here', { nick: 'Ana' }));
      await waitFor(() => completeCalls === 1);

      // The mention resets the window and bumps the generation while the
      // scoring call is in flight.
      core.receive(mention(seeded, member, roomJid, 'm-2'));
      release();
      await waitFor(() => calls.length === 1);
      await tick(50);
      expect(completeCalls).toBe(1);
      expect(core.sent.some((message) => message.text === 'Gateway AI is looking at this')).toBe(
        false,
      );
    });

    it('wakes nobody when the scoring call throws', async () => {
      let attempts = 0;
      const { member, roomJid, core, calls } = await listenerSetup({
        quietMs: 10,
        complete: () => async () => {
          attempts += 1;
          throw new Error('boom');
        },
      });
      core.receive(roomMessage(roomJid, member.jid, 'm-1', 'no mention here', { nick: 'Ana' }));
      await waitFor(() => attempts === 1);
      await tick(20);
      expect(calls).toHaveLength(0);
      expect(core.sent).toHaveLength(0);
    });

    it('wakes nobody when the scoring call returns garbage', async () => {
      let attempts = 0;
      const { member, roomJid, core, calls } = await listenerSetup({
        quietMs: 10,
        complete: () => async () => {
          attempts += 1;
          return 'not json at all';
        },
      });
      core.receive(roomMessage(roomJid, member.jid, 'm-1', 'no mention here', { nick: 'Ana' }));
      await waitFor(() => attempts === 1);
      await tick(20);
      expect(calls).toHaveLength(0);
      expect(core.sent).toHaveLength(0);
    });

    it('clears the pending timer when the AI is disconnected', async () => {
      const { seeded, member, roomJid, core, calls, litellm } = await listenerSetup({
        quietMs: 200,
      });
      const deps = aiServiceDeps(litellm);
      core.receive(roomMessage(roomJid, member.jid, 'm-1', 'no mention here', { nick: 'Ana' }));
      await stopAi(deps, seeded.aiId, seeded.ownerId);
      await waitFor(() => startedSize() === 0);
      await tick(260);
      expect(calls).toHaveLength(0);
      expect(core.sent).toHaveLength(0);
    });

    // T-0479: the per-human-message round budget and the wake line timing.
    it('caps a round at four AI turns for one human message', async () => {
      const { seeded, extras, member, roomJid, cores, calls } = await listenerSetup({
        aiCount: 5,
        listener: false,
      });
      const all = [seeded, ...extras];
      const message = roomMessage(roomJid, member.jid, 'm-1', 'hello all', {
        nick: 'Ana',
        mentions: all.map((ai) => ai.aiJid),
      });
      for (const ai of all) {
        const core = await coreFor(cores, ai.aiJid);
        core.receive(message);
      }

      await waitFor(() => calls.length === 4);
      await tick(50);
      expect(calls).toHaveLength(4);
    });

    it('opens one round when the same message reaches several sessions', async () => {
      const { seeded, extras, member, roomJid, cores, calls } = await listenerSetup({
        aiCount: 5,
        listener: false,
      });
      const all = [seeded, ...extras];
      const message = roomMessage(roomJid, member.jid, 'm-1', 'hello all', {
        nick: 'Ana',
        mentions: all.map((ai) => ai.aiJid),
      });
      // Three sessions see the message first and spend three turns.
      for (const ai of all.slice(0, 3)) {
        const core = await coreFor(cores, ai.aiJid);
        core.receive(message);
      }
      await waitFor(() => calls.length === 3);

      // The other two sessions see the same id: it must not reset the round,
      // so only one more turn fits.
      for (const ai of all.slice(3)) {
        const core = await coreFor(cores, ai.aiJid);
        core.receive(message);
      }
      await waitFor(() => calls.length === 4);
      await tick(50);
      expect(calls).toHaveLength(4);
    });

    it('opens a fresh round for a new human message', async () => {
      const { seeded, extras, member, roomJid, cores, calls } = await listenerSetup({
        aiCount: 5,
        listener: false,
      });
      const all = [seeded, ...extras];
      const send = async (id: string): Promise<void> => {
        const message = roomMessage(roomJid, member.jid, id, `hello ${id}`, {
          nick: 'Ana',
          mentions: all.map((ai) => ai.aiJid),
        });
        for (const ai of all) {
          const core = await coreFor(cores, ai.aiJid);
          core.receive(message);
        }
      };

      await send('m-1');
      await waitFor(() => calls.length === 4);
      await send('m-2');
      await waitFor(() => calls.length === 8);
      await tick(50);
      expect(calls).toHaveLength(8);
    });

    // T-0481: AI-to-AI handoff by @mention, inside the round's hop budget.
    describe('AI handoff (T-0481)', () => {
      function routedFetch(
        pick: (body: { messages: Array<{ role: string; content: string }> }) => string,
      ): { fetchImpl: FetchLike; calls: Call[] } {
        const calls: Call[] = [];
        const fetchImpl: FetchLike = (url, init) => {
          calls.push({ url, init });
          const body = JSON.parse(String(init?.body)) as {
            messages: Array<{ role: string; content: string }>;
          };
          return Promise.resolve(completionResponse(pick(body)));
        };
        return { fetchImpl, calls };
      }

      function systemOf(call: Call): string {
        return bodyOf(call).messages[0]?.content ?? '';
      }

      function mentionsOf(opts: unknown): Array<{ jid: string; begin: number; end: number }> {
        return (
          (opts as { mentions?: Array<{ jid: string; begin: number; end: number }> }).mentions ?? []
        );
      }

      function toolsOf(call: Call): Array<{ function: { name: string } }> {
        const body = JSON.parse(String(call.init.body)) as {
          tools?: Array<{ function: { name: string } }>;
        };
        return body.tools ?? [];
      }

      async function setAccepts(ai: SeededAi, accepts: boolean): Promise<void> {
        await testSql(context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`UPDATE ais SET accepts_delegation = ${accepts} WHERE id = ${ai.aiId}`;
          }),
        );
      }

      async function receiveOn(
        cores: FakeCore[],
        aiJid: string,
        message: ChatMessage,
      ): Promise<void> {
        const core = await coreFor(cores, aiJid);
        core.receive(message);
      }

      function actionGateway(): ActionGateway {
        return {
          request: async () => ({ status: 'pending_approval', approvalId: 'appr-1' }),
          onApprovalDecided: () => Promise.resolve(),
          recoverStuck: () => Promise.resolve(),
          listActions: () => [{ name: 'demo.echo', description: 'Repeats text.' }],
        };
      }

      it('wakes a target that accepts tasks, and the handoff turn offers no request_action', async () => {
        const { seeded, extras, member, roomJid, cores, calls } = await listenerSetup({
          aiCount: 2,
          names: ['Alpha', 'Helper'],
          listener: false,
          actions: actionGateway(),
          fetch: () =>
            routedFetch((body) =>
              (body.messages[0]?.content ?? '').includes('You are Alpha')
                ? '@Helper please take this'
                : 'on it',
            ),
        });
        const helper = extras[0]!;
        await setAccepts(helper, true);
        const alphaCore = await coreFor(cores, seeded.aiJid);
        const helperCore = await coreFor(cores, helper.aiJid);

        alphaCore.receive(
          roomMessage(roomJid, member.jid, 'm-1', 'hey Alpha', {
            nick: 'Ana',
            mentions: [seeded.aiJid],
          }),
        );
        await waitFor(() => alphaCore.sent.length === 1);

        // The prompt offers Helper, and the reply carries the handoff mention.
        expect(systemOf(calls[0]!)).toContain('hand a question to: @Helper');
        const alphaSent = alphaCore.sent.at(-1)!;
        expect(mentionsOf(alphaSent.opts)).toEqual([
          { jid: member.jid, begin: 0, end: 4 },
          { jid: helper.aiJid, begin: 5, end: 12 },
        ]);

        // Deliver that reply: Helper takes a normal turn, with no action tool.
        helperCore.receive(
          roomMessage(roomJid, seeded.aiJid, 'a-1', alphaSent.text, {
            nick: 'Alpha',
            mentions: mentionsOf(alphaSent.opts).map((mention) => mention.jid),
          }),
        );
        await waitFor(() => calls.length === 2);
        await waitFor(() => helperCore.sent.length === 1);
        const handoffTools = toolsOf(calls[1]!);
        expect(handoffTools.some((tool) => tool.function.name === 'request_action')).toBe(false);
      });

      it('never offers or wakes a target that does not accept tasks', async () => {
        const { seeded, member, roomJid, cores, calls } = await listenerSetup({
          aiCount: 2,
          names: ['Alpha', 'Helper'],
          listener: false,
          fetch: () => routedFetch(() => '@Helper please take this'),
        });
        // Helper acceptsDelegation stays off.
        const alphaCore = await coreFor(cores, seeded.aiJid);
        alphaCore.receive(
          roomMessage(roomJid, member.jid, 'm-1', 'hey Alpha', {
            nick: 'Ana',
            mentions: [seeded.aiJid],
          }),
        );
        await waitFor(() => alphaCore.sent.length === 1);

        expect(systemOf(calls[0]!)).not.toContain('hand a question to');
        expect(mentionsOf(alphaCore.sent.at(-1)!.opts)).toEqual([
          { jid: member.jid, begin: 0, end: 4 },
        ]);
        await tick(40);
        expect(calls).toHaveLength(1);
      });

      it('stops an A to B to A to B chain after two hops', async () => {
        const { seeded, extras, member, roomJid, cores, calls } = await listenerSetup({
          aiCount: 2,
          names: ['Alpha', 'Helper'],
          listener: false,
          fetch: () => completionFetch('on it'),
        });
        const helper = extras[0]!;
        await setAccepts(seeded, true);
        await setAccepts(helper, true);

        await receiveOn(
          cores,
          seeded.aiJid,
          roomMessage(roomJid, member.jid, 'm-1', 'hey Alpha', {
            nick: 'Ana',
            mentions: [seeded.aiJid],
          }),
        );
        await waitFor(() => calls.length === 1);

        await receiveOn(
          cores,
          helper.aiJid,
          roomMessage(roomJid, seeded.aiJid, 'a-1', 'take this', {
            nick: 'Alpha',
            mentions: [helper.aiJid],
          }),
        );
        await waitFor(() => calls.length === 2);

        await receiveOn(
          cores,
          seeded.aiJid,
          roomMessage(roomJid, helper.aiJid, 'b-1', 'over to you', {
            nick: 'Helper',
            mentions: [seeded.aiJid],
          }),
        );
        await waitFor(() => calls.length === 3);

        // The second hop is spent: this third AI message wakes nobody.
        await receiveOn(
          cores,
          helper.aiJid,
          roomMessage(roomJid, seeded.aiJid, 'a-2', 'again', {
            nick: 'Alpha',
            mentions: [helper.aiJid],
          }),
        );
        await tick(50);
        expect(calls).toHaveLength(3);
      });

      it('counts one hop when several sessions see the same AI message', async () => {
        const { seeded, extras, member, roomJid, cores, calls } = await listenerSetup({
          aiCount: 4,
          names: ['Alpha', 'Bee', 'Cee', 'Dee'],
          listener: false,
          fetch: () => completionFetch('on it'),
        });
        const [bee, cee, dee] = extras as [SeededAi, SeededAi, SeededAi];
        for (const ai of [seeded, bee, cee, dee]) {
          await setAccepts(ai, true);
        }
        // A human message that wakes nobody opens the round.
        await receiveOn(
          cores,
          seeded.aiJid,
          roomMessage(roomJid, member.jid, 'm-1', 'hello all', { nick: 'Ana' }),
        );
        await tick(20);

        const first = roomMessage(roomJid, seeded.aiJid, 'a-1', 'three of you', {
          nick: 'Alpha',
          mentions: [bee.aiJid, cee.aiJid, dee.aiJid],
        });
        await receiveOn(cores, bee.aiJid, first);
        await receiveOn(cores, cee.aiJid, first);
        await receiveOn(cores, dee.aiJid, first);
        await waitFor(() => calls.length === 3);

        // One hop was spent for the whole message, so one handoff still fits.
        await receiveOn(
          cores,
          dee.aiJid,
          roomMessage(roomJid, bee.aiJid, 'a-2', 'one more', {
            nick: 'Bee',
            mentions: [dee.aiJid],
          }),
        );
        await waitFor(() => calls.length === 4);
        await tick(40);
        expect(calls).toHaveLength(4);
      });

      it('ignores an AI message from a JID that is not a live room session', async () => {
        const { seeded, extras, member, roomJid, cores, calls } = await listenerSetup({
          aiCount: 2,
          names: ['Alpha', 'Helper'],
          listener: false,
          fetch: () => completionFetch('on it'),
        });
        const helper = extras[0]!;
        await setAccepts(helper, true);
        await receiveOn(
          cores,
          seeded.aiJid,
          roomMessage(roomJid, member.jid, 'm-1', 'hello all', { nick: 'Ana' }),
        );
        await tick(20);

        await receiveOn(
          cores,
          helper.aiJid,
          roomMessage(roomJid, `ai-stranger@${TEST_XMPP_DOMAIN}`, 'a-1', 'take this', {
            nick: 'Stranger',
            mentions: [helper.aiJid],
          }),
        );
        await tick(50);
        expect(calls).toHaveLength(0);
      });

      it('keeps one human message at four AI turns across two hops', async () => {
        const { seeded, extras, member, roomJid, cores, calls } = await listenerSetup({
          aiCount: 2,
          names: ['Alpha', 'Helper'],
          listener: false,
          fetch: () => completionFetch('on it'),
        });
        const helper = extras[0]!;
        await setAccepts(seeded, true);
        await setAccepts(helper, true);

        // The human wakes both AIs: two turns.
        const human = roomMessage(roomJid, member.jid, 'm-1', 'hey both', {
          nick: 'Ana',
          mentions: [seeded.aiJid, helper.aiJid],
        });
        await receiveOn(cores, seeded.aiJid, human);
        await receiveOn(cores, helper.aiJid, human);
        await waitFor(() => calls.length === 2);

        // Hop one and hop two bring the total to four; a third is refused.
        await receiveOn(
          cores,
          helper.aiJid,
          roomMessage(roomJid, seeded.aiJid, 'a-1', 'take this', {
            nick: 'Alpha',
            mentions: [helper.aiJid],
          }),
        );
        await waitFor(() => calls.length === 3);
        await receiveOn(
          cores,
          seeded.aiJid,
          roomMessage(roomJid, helper.aiJid, 'b-1', 'over to you', {
            nick: 'Helper',
            mentions: [seeded.aiJid],
          }),
        );
        await waitFor(() => calls.length === 4);
        await receiveOn(
          cores,
          helper.aiJid,
          roomMessage(roomJid, seeded.aiJid, 'a-2', 'again', {
            nick: 'Alpha',
            mentions: [helper.aiJid],
          }),
        );
        await tick(50);
        expect(calls).toHaveLength(4);
      });
    });

    describe('delegation tools (T-0482)', () => {
      const BOSS_NAME = 'Alpha';
      const WORKER_NAME = 'Helper';

      async function setFlags(
        ai: SeededAi,
        flags: { canDelegate?: boolean; acceptsDelegation?: boolean },
      ): Promise<void> {
        const changes: { can_delegate?: boolean; accepts_delegation?: boolean } = {};
        if (flags.canDelegate !== undefined) changes.can_delegate = flags.canDelegate;
        if (flags.acceptsDelegation !== undefined)
          changes.accepts_delegation = flags.acceptsDelegation;
        await testSql(context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            if (changes.can_delegate !== undefined) {
              yield* sql`UPDATE ais SET can_delegate = ${changes.can_delegate} WHERE id = ${ai.aiId}`;
            }
            if (changes.accepts_delegation !== undefined) {
              yield* sql`UPDATE ais SET accepts_delegation = ${changes.accepts_delegation}
                WHERE id = ${ai.aiId}`;
            }
          }),
        );
      }

      interface ScriptedCall {
        toolCalls?: Array<{ name: string; args: () => unknown }>;
        content?: string;
      }

      // A fetch keyed by the system prompt's "You are <name>", so the boss and
      // the worker get their own script regardless of how their turns
      // interleave.
      function scriptedFetch(config: {
        scripts: Record<string, ScriptedCall[]>;
        fallback?: string;
      }): { fetchImpl: FetchLike; calls: Call[] } {
        const calls: Call[] = [];
        const index: Record<string, number> = {};
        const fetchImpl: FetchLike = (_url, init) => {
          calls.push({ url: _url, init: init ?? { headers: new Headers() } });
          const body = JSON.parse(String(init?.body)) as {
            messages: Array<{ role: string; content: string }>;
          };
          const system = body.messages[0]?.content ?? '';
          const name = Object.keys(config.scripts).find((candidate) =>
            system.includes(`You are ${candidate}`),
          );
          if (name === undefined) {
            return Promise.resolve(completionResponse(config.fallback ?? 'ok'));
          }
          const list = config.scripts[name]!;
          const step = list[Math.min(index[name] ?? 0, list.length - 1)]!;
          index[name] = (index[name] ?? 0) + 1;
          if (step.toolCalls !== undefined) {
            return Promise.resolve(
              jsonResponse({
                choices: [
                  {
                    message: {
                      content: step.content ?? null,
                      tool_calls: step.toolCalls.map((call, position) => ({
                        id: `call-${position + 1}`,
                        type: 'function',
                        function: { name: call.name, arguments: JSON.stringify(call.args()) },
                      })),
                    },
                  },
                ],
              }),
            );
          }
          return Promise.resolve(completionResponse(step.content ?? 'done'));
        };
        return { fetchImpl, calls };
      }

      function callsFor(calls: Call[], name: string): Call[] {
        const needle = `You are ${name}`;
        return calls.filter((call) => {
          const body = JSON.parse(String(call.init.body)) as {
            messages: Array<{ content: string }>;
          };
          return (body.messages[0]?.content ?? '').includes(needle);
        });
      }

      function toolsOf(call: Call): string[] {
        const body = JSON.parse(String(call.init.body)) as {
          tools?: Array<{ function: { name: string } }>;
        };
        return (body.tools ?? []).map((tool) => tool.function.name);
      }

      function toolResultsOf(call: Call): string[] {
        const body = JSON.parse(String(call.init.body)) as {
          messages: Array<{ role: string; content: string }>;
        };
        return body.messages
          .filter((message) => message.role === 'tool')
          .map((message) => message.content);
      }

      interface DelegationRow {
        id: string;
        fromAiId: string;
        toAiId: string;
        status: string;
        objective: string;
        resultSummary: string | null;
      }

      function delegationRows(): Promise<readonly DelegationRow[]> {
        return testSql(context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<DelegationRow>`SELECT id, from_ai_id, to_ai_id, status,
              objective, result_summary FROM ai_delegations`;
          }),
        );
      }

      it('delegates to an accepting AI, wakes it, and stores the completed reply', async () => {
        let workerId = '';
        const { seeded, extras, member, roomJid, cores, calls } = await listenerSetup({
          aiCount: 2,
          names: [BOSS_NAME, WORKER_NAME],
          listener: false,
          fetch: () =>
            scriptedFetch({
              scripts: {
                [BOSS_NAME]: [
                  {
                    toolCalls: [
                      {
                        name: 'delegate',
                        args: () => ({ to: workerId, objective: 'write the report' }),
                      },
                    ],
                  },
                  { content: 'delegated' },
                ],
              },
              fallback: 'the report is done',
            }),
        });
        const worker = extras[0]!;
        workerId = worker.aiId;
        await setFlags(seeded, { canDelegate: true });
        await setFlags(worker, { acceptsDelegation: true });

        const bossCore = await coreFor(cores, seeded.aiJid);
        const workerCore = await coreFor(cores, worker.aiJid);
        bossCore.receive(
          roomMessage(roomJid, member.jid, 'm-1', 'hey Alpha', {
            nick: 'Ana',
            mentions: [seeded.aiJid],
          }),
        );

        await waitFor(() => workerCore.sent.length === 1);
        await vi.waitFor(async () => {
          const rows = await delegationRows();
          expect(rows[0]?.status).toBe('completed');
        });

        // The boss was offered both delegation tools.
        const bossCalls = callsFor(calls, BOSS_NAME);
        expect(toolsOf(bossCalls[0]!)).toContain('delegate');
        expect(toolsOf(bossCalls[0]!)).toContain('task_status');

        // The worker's prompt carries the task line with the boss nick.
        const workerCalls = callsFor(calls, WORKER_NAME);
        expect(workerCalls).toHaveLength(1);
        const workerMessages = JSON.parse(String(workerCalls[0]!.init.body)).messages as Array<{
          content: string;
        }>;
        expect(
          workerMessages.some((message) =>
            message.content.includes('Task from Alpha: write the report'),
          ),
        ).toBe(true);

        // The row records the worker's reply and the worker's answer mentions
        // the boss.
        const rows = await delegationRows();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.fromAiId).toBe(seeded.aiId);
        expect(rows[0]!.toAiId).toBe(worker.aiId);
        expect(rows[0]!.resultSummary).toBe('@Alpha the report is done');
        expect(workerCore.sent[0]!.text).toBe('@Alpha the report is done');
        const mentions = (workerCore.sent[0]!.opts as { mentions?: Array<{ jid: string }> })
          .mentions;
        expect(mentions?.map((mention) => mention.jid)).toContain(seeded.aiJid);
      });

      it('does not offer delegate without canDelegate and answers an improvised call invalid', async () => {
        const { seeded, extras, member, roomJid, cores, calls } = await listenerSetup({
          aiCount: 2,
          names: [BOSS_NAME, WORKER_NAME],
          listener: false,
          fetch: () =>
            scriptedFetch({
              scripts: {
                [BOSS_NAME]: [
                  {
                    toolCalls: [
                      { name: 'delegate', args: () => ({ to: 'ai-someone', objective: 'x' }) },
                    ],
                  },
                  { content: 'ok' },
                ],
              },
            }),
        });
        const worker = extras[0]!;
        await setFlags(worker, { acceptsDelegation: true });

        const bossCore = await coreFor(cores, seeded.aiJid);
        bossCore.receive(
          roomMessage(roomJid, member.jid, 'm-1', 'hey Alpha', {
            nick: 'Ana',
            mentions: [seeded.aiJid],
          }),
        );

        await waitFor(() => callsFor(calls, BOSS_NAME).length >= 2);
        const bossCalls = callsFor(calls, BOSS_NAME);
        expect(toolsOf(bossCalls[0]!)).not.toContain('delegate');
        expect(toolsOf(bossCalls[0]!)).not.toContain('task_status');
        expect(toolResultsOf(bossCalls[1]!)).toContain('invalid: unknown tool');
        expect(await delegationRows()).toHaveLength(0);
      });

      it('answers an unknown delegation target with invalid: unknown AI', async () => {
        const { seeded, extras, member, roomJid, cores, calls } = await listenerSetup({
          aiCount: 2,
          names: [BOSS_NAME, WORKER_NAME],
          listener: false,
          fetch: () =>
            scriptedFetch({
              scripts: {
                [BOSS_NAME]: [
                  {
                    toolCalls: [
                      { name: 'delegate', args: () => ({ to: 'ai-nobody', objective: 'x' }) },
                    ],
                  },
                  { content: 'ok' },
                ],
              },
            }),
        });
        await setFlags(seeded, { canDelegate: true });
        await setFlags(extras[0]!, { acceptsDelegation: true });

        const bossCore = await coreFor(cores, seeded.aiJid);
        bossCore.receive(
          roomMessage(roomJid, member.jid, 'm-1', 'hey Alpha', {
            nick: 'Ana',
            mentions: [seeded.aiJid],
          }),
        );

        await waitFor(() => callsFor(calls, BOSS_NAME).length >= 2);
        const bossCalls = callsFor(calls, BOSS_NAME);
        expect(toolResultsOf(bossCalls[1]!)).toContain('invalid: unknown AI');
        expect(await delegationRows()).toHaveLength(0);
      });

      it('refuses a delegate once the round has spent its hops', async () => {
        let workerId = '';
        const { seeded, extras, member, roomJid, cores, calls } = await listenerSetup({
          aiCount: 2,
          names: [BOSS_NAME, WORKER_NAME],
          listener: false,
          fetch: () =>
            scriptedFetch({
              scripts: {
                [BOSS_NAME]: [
                  {
                    toolCalls: [
                      { name: 'delegate', args: () => ({ to: workerId, objective: 'one' }) },
                      { name: 'delegate', args: () => ({ to: workerId, objective: 'two' }) },
                      { name: 'delegate', args: () => ({ to: workerId, objective: 'three' }) },
                    ],
                  },
                  { content: 'done' },
                ],
              },
              fallback: 'worker done',
            }),
        });
        const worker = extras[0]!;
        workerId = worker.aiId;
        await setFlags(seeded, { canDelegate: true });
        await setFlags(worker, { acceptsDelegation: true });

        const bossCore = await coreFor(cores, seeded.aiJid);
        bossCore.receive(
          roomMessage(roomJid, member.jid, 'm-1', 'hey Alpha', {
            nick: 'Ana',
            mentions: [seeded.aiJid],
          }),
        );

        await waitFor(() => callsFor(calls, BOSS_NAME).length >= 2);
        const bossCalls = callsFor(calls, BOSS_NAME);
        expect(toolResultsOf(bossCalls[1]!)).toContain('refused: no hops left for this message');
        await vi.waitFor(async () => {
          const rows = await delegationRows();
          expect(rows).toHaveLength(2);
          expect(rows.every((row) => row.status === 'completed')).toBe(true);
        });
      });

      it('answers task_status from a third AI with invalid: unknown task', async () => {
        const taskId = randomUUID();
        const { seeded, extras, groupId, member, roomJid, cores, calls } = await listenerSetup({
          aiCount: 3,
          names: [BOSS_NAME, WORKER_NAME, 'Other'],
          listener: false,
          fetch: () =>
            scriptedFetch({
              scripts: {
                Other: [
                  { toolCalls: [{ name: 'task_status', args: () => ({ task_id: taskId }) }] },
                  { content: 'checked' },
                ],
              },
            }),
        });
        const [worker, other] = extras as [SeededAi, SeededAi];
        await testSql(context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`INSERT INTO ai_delegations ${sql.insert({
              id: taskId,
              from_ai_id: seeded.aiId,
              to_ai_id: worker.aiId,
              group_id: groupId,
              objective: 'a stored task',
            })}`;
          }),
        );
        await setFlags(other, { canDelegate: true });
        await setFlags(worker, { acceptsDelegation: true });

        const otherCore = await coreFor(cores, other.aiJid);
        otherCore.receive(
          roomMessage(roomJid, member.jid, 'm-1', 'hey Other', {
            nick: 'Ana',
            mentions: [other.aiJid],
          }),
        );

        await waitFor(() => callsFor(calls, 'Other').length >= 2);
        const otherCalls = callsFor(calls, 'Other');
        expect(toolsOf(otherCalls[0]!)).toContain('task_status');
        expect(toolResultsOf(otherCalls[1]!)).toContain('invalid: unknown task');
      });

      it('reads a task_status for an involved AI', async () => {
        const taskId = randomUUID();
        const { seeded, extras, groupId, member, roomJid, cores, calls } = await listenerSetup({
          aiCount: 2,
          names: [BOSS_NAME, WORKER_NAME],
          listener: false,
          fetch: () =>
            scriptedFetch({
              scripts: {
                [BOSS_NAME]: [
                  { toolCalls: [{ name: 'task_status', args: () => ({ task_id: taskId }) }] },
                  { content: 'checked' },
                ],
              },
            }),
        });
        const worker = extras[0]!;
        await testSql(context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`INSERT INTO ai_delegations ${sql.insert({
              id: taskId,
              from_ai_id: seeded.aiId,
              to_ai_id: worker.aiId,
              group_id: groupId,
              objective: 'a stored task',
              status: 'completed',
              result_summary: 'the report is ready',
            })}`;
          }),
        );
        await setFlags(seeded, { canDelegate: true });
        await setFlags(worker, { acceptsDelegation: true });

        const bossCore = await coreFor(cores, seeded.aiJid);
        bossCore.receive(
          roomMessage(roomJid, member.jid, 'm-1', 'hey Alpha', {
            nick: 'Ana',
            mentions: [seeded.aiJid],
          }),
        );

        await waitFor(() => callsFor(calls, BOSS_NAME).length >= 2);
        const bossCalls = callsFor(calls, BOSS_NAME);
        expect(toolsOf(bossCalls[0]!)).toContain('task_status');
        expect(toolResultsOf(bossCalls[1]!)).toContain(
          JSON.stringify({ task_id: taskId, status: 'completed', result: 'the report is ready' }),
        );
      });

      it('answers task_status in a DM with invalid: unknown tool', async () => {
        const taskId = randomUUID();
        const { seeded, extras, groupId, cores, calls } = await listenerSetup({
          aiCount: 2,
          names: [BOSS_NAME, WORKER_NAME],
          listener: false,
          fetch: () =>
            scriptedFetch({
              scripts: {
                [BOSS_NAME]: [
                  { toolCalls: [{ name: 'task_status', args: () => ({ task_id: taskId }) }] },
                  { content: 'checked' },
                ],
              },
            }),
        });
        const worker = extras[0]!;
        // The row is real and involves this AI, so the only reason to refuse
        // is the missing group context.
        await testSql(context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`INSERT INTO ai_delegations ${sql.insert({
              id: taskId,
              from_ai_id: seeded.aiId,
              to_ai_id: worker.aiId,
              group_id: groupId,
              objective: 'a stored task',
              status: 'completed',
              result_summary: 'the report is ready',
            })}`;
          }),
        );
        await setFlags(seeded, { canDelegate: true });
        await setFlags(worker, { acceptsDelegation: true });

        const bossCore = await coreFor(cores, seeded.aiJid);
        bossCore.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'check the task'));

        await waitFor(() => callsFor(calls, BOSS_NAME).length >= 2);
        const bossCalls = callsFor(calls, BOSS_NAME);
        expect(toolsOf(bossCalls[0]!)).not.toContain('task_status');
        expect(toolResultsOf(bossCalls[1]!)).toContain('invalid: unknown tool');
      });

      it('reads a completed task_status for the boss after the worker left the room', async () => {
        let workerId = '';
        let taskId = '';
        const { seeded, extras, groupId, member, roomJid, cores, calls } = await listenerSetup({
          aiCount: 2,
          names: [BOSS_NAME, WORKER_NAME],
          listener: false,
          fetch: () =>
            scriptedFetch({
              scripts: {
                [BOSS_NAME]: [
                  {
                    toolCalls: [
                      { name: 'delegate', args: () => ({ to: workerId, objective: 'write it' }) },
                    ],
                  },
                  { content: 'delegated' },
                  { toolCalls: [{ name: 'task_status', args: () => ({ task_id: taskId }) }] },
                  { content: 'checked' },
                ],
              },
              fallback: 'the report is done',
            }),
        });
        const worker = extras[0]!;
        workerId = worker.aiId;
        await setFlags(seeded, { canDelegate: true });
        await setFlags(worker, { acceptsDelegation: true });

        const bossCore = await coreFor(cores, seeded.aiJid);
        const workerCore = await coreFor(cores, worker.aiJid);
        bossCore.receive(
          roomMessage(roomJid, member.jid, 'm-1', 'hey Alpha', {
            nick: 'Ana',
            mentions: [seeded.aiJid],
          }),
        );

        await vi.waitFor(async () => {
          const rows = await delegationRows();
          expect(rows[0]?.status).toBe('completed');
        });
        taskId = (await delegationRows())[0]!.id;

        // The worker leaves the room, so the boss has no delegation targets:
        // the tool is not offered, but an improvised call still reads the row.
        await testSql(context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`DELETE FROM group_ais WHERE group_id = ${groupId} AND ai_id = ${worker.aiId}`;
          }),
        );
        emitGroupAi({ type: 'ai-removed', groupId, aiId: worker.aiId });
        await waitFor(() => workerCore.left.length === 1);

        bossCore.receive(
          roomMessage(roomJid, member.jid, 'm-2', 'check it', {
            nick: 'Ana',
            mentions: [seeded.aiJid],
          }),
        );

        await waitFor(() => callsFor(calls, BOSS_NAME).length >= 4);
        const bossCalls = callsFor(calls, BOSS_NAME);
        expect(toolsOf(bossCalls[2]!)).not.toContain('task_status');
        expect(toolResultsOf(bossCalls[3]!)).toContain(
          JSON.stringify({
            task_id: taskId,
            status: 'completed',
            result: '@Alpha the report is done',
          }),
        );
      });

      it('lets an accepting worker read its own task without canDelegate', async () => {
        const taskId = randomUUID();
        const { seeded, extras, groupId, member, roomJid, cores, calls } = await listenerSetup({
          aiCount: 2,
          names: [BOSS_NAME, WORKER_NAME],
          listener: false,
          fetch: () =>
            scriptedFetch({
              scripts: {
                [WORKER_NAME]: [
                  { toolCalls: [{ name: 'task_status', args: () => ({ task_id: taskId }) }] },
                  { content: 'checked' },
                ],
              },
            }),
        });
        const worker = extras[0]!;
        await testSql(context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`INSERT INTO ai_delegations ${sql.insert({
              id: taskId,
              from_ai_id: seeded.aiId,
              to_ai_id: worker.aiId,
              group_id: groupId,
              objective: 'a stored task',
              status: 'completed',
              result_summary: 'the report is ready',
            })}`;
          }),
        );
        await setFlags(worker, { acceptsDelegation: true });

        const workerCore = await coreFor(cores, worker.aiJid);
        workerCore.receive(
          roomMessage(roomJid, member.jid, 'm-1', 'hey Helper', {
            nick: 'Ana',
            mentions: [worker.aiJid],
          }),
        );

        await waitFor(() => callsFor(calls, WORKER_NAME).length >= 2);
        const workerCalls = callsFor(calls, WORKER_NAME);
        expect(toolsOf(workerCalls[0]!)).not.toContain('task_status');
        expect(toolResultsOf(workerCalls[1]!)).toContain(
          JSON.stringify({ task_id: taskId, status: 'completed', result: 'the report is ready' }),
        );
      });

      it('answers task_status from an uninvolved AI with invalid: unknown task when there are no targets', async () => {
        const taskId = randomUUID();
        const { seeded, extras, groupId, member, roomJid, cores, calls } = await listenerSetup({
          aiCount: 3,
          names: [BOSS_NAME, WORKER_NAME, 'Other'],
          listener: false,
          fetch: () =>
            scriptedFetch({
              scripts: {
                Other: [
                  { toolCalls: [{ name: 'task_status', args: () => ({ task_id: taskId }) }] },
                  { content: 'checked' },
                ],
              },
            }),
        });
        const [worker, other] = extras as [SeededAi, SeededAi];
        await testSql(context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`INSERT INTO ai_delegations ${sql.insert({
              id: taskId,
              from_ai_id: seeded.aiId,
              to_ai_id: worker.aiId,
              group_id: groupId,
              objective: 'a stored task',
              status: 'completed',
              result_summary: 'the report is ready',
            })}`;
          }),
        );

        const otherCore = await coreFor(cores, other.aiJid);
        otherCore.receive(
          roomMessage(roomJid, member.jid, 'm-1', 'hey Other', {
            nick: 'Ana',
            mentions: [other.aiJid],
          }),
        );

        await waitFor(() => callsFor(calls, 'Other').length >= 2);
        const otherCalls = callsFor(calls, 'Other');
        expect(toolsOf(otherCalls[0]!)).not.toContain('task_status');
        expect(toolResultsOf(otherCalls[1]!)).toContain('invalid: unknown task');
      });

      it('leaves a delegated row failed when the worker is over its daily limit', async () => {
        let workerId = '';
        const { seeded, extras, member, roomJid, cores, calls, litellm } = await listenerSetup({
          aiCount: 2,
          names: [BOSS_NAME, WORKER_NAME],
          listener: false,
          now: () => NOW,
          fetch: () =>
            scriptedFetch({
              scripts: {
                [BOSS_NAME]: [
                  {
                    toolCalls: [
                      { name: 'delegate', args: () => ({ to: workerId, objective: 'write it' }) },
                    ],
                  },
                  { content: 'delegated' },
                ],
              },
              fallback: 'worker done',
            }),
        });
        const worker = extras[0]!;
        workerId = worker.aiId;
        await setFlags(seeded, { canDelegate: true });
        await setFlags(worker, { acceptsDelegation: true });
        // The worker already spent today's cap, but its baseline still reads
        // as zero, so the delta crosses the limit. The boss has no baseline
        // yet, so it records the current spend and runs.
        await testSql(context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`INSERT INTO ai_daily_spend ${sql.insert({
              ai_id: worker.aiId,
              day: NOW.toISOString().slice(0, 10),
              baseline_usd: '0.00',
            })}`;
          }),
        );
        litellm.spendByKey.set('tok-1', 2);

        const bossCore = await coreFor(cores, seeded.aiJid);
        bossCore.receive(
          roomMessage(roomJid, member.jid, 'm-1', 'hey Alpha', {
            nick: 'Ana',
            mentions: [seeded.aiJid],
          }),
        );

        await vi.waitFor(async () => {
          const rows = await delegationRows();
          expect(rows[0]?.status).toBe('failed');
        });
        const rows = await delegationRows();
        expect(rows[0]!.resultSummary).toBeNull();
        expect(callsFor(calls, WORKER_NAME)).toHaveLength(0);
      });
    });

    it('posts the wake line only once the woken turn passes the gates', async () => {
      const { member, roomJid, core, calls } = await listenerSetup({ quietMs: 10 });
      core.receive(roomMessage(roomJid, member.jid, 'm-1', 'no mention here', { nick: 'Ana' }));

      await waitFor(() => calls.length === 1);
      await waitFor(() => core.sent.length >= 2);
      expect(core.sent[0]?.text).toBe('Gateway AI is looking at this');
      expect(core.sent[1]?.text).toContain('AI says hi');
    });

    it('posts no wake line when the woken AI is at its room rate limit', async () => {
      const { seeded, member, roomJid, core, calls } = await listenerSetup({ quietMs: 10 });
      for (let index = 1; index <= 6; index += 1) {
        core.receive(
          roomMessage(roomJid, member.jid, `r-${index}`, 'hey', {
            nick: 'Ana',
            mentions: [seeded.aiJid],
          }),
        );
        await waitFor(() => calls.length === index);
      }
      expect(core.sent).toHaveLength(6);

      core.receive(
        roomMessage(roomJid, member.jid, 'm-listen', 'no mention here', { nick: 'Ana' }),
      );
      await tick(120);
      expect(calls).toHaveLength(6);
      expect(core.sent).toHaveLength(6);
      expect(core.sent.some((message) => message.text === 'Gateway AI is looking at this')).toBe(
        false,
      );
    });

    it('posts no wake line when the woken AI is over its daily limit', async () => {
      const { seeded, member, roomJid, core, calls, litellm } = await listenerSetup({
        quietMs: 10,
      });
      litellm.spendByKey.set('tok-1', 0.5);
      core.receive(
        roomMessage(roomJid, member.jid, 'm-1', 'hey', { nick: 'Ana', mentions: [seeded.aiJid] }),
      );
      await waitFor(() => calls.length === 1);

      litellm.spendByKey.set('tok-1', 2);
      core.receive(roomMessage(roomJid, member.jid, 'm-2', 'no mention here', { nick: 'Ana' }));
      await tick(120);
      expect(calls).toHaveLength(1);
      expect(core.sent.some((message) => message.text === 'Gateway AI is looking at this')).toBe(
        false,
      );
    });

    it('posts no wake line for a mention turn', async () => {
      const { seeded, member, roomJid, core, calls } = await listenerSetup({ quietMs: 10 });
      core.receive(
        roomMessage(roomJid, member.jid, 'm-1', 'hey', { nick: 'Ana', mentions: [seeded.aiJid] }),
      );
      await waitFor(() => calls.length === 1);
      expect(core.sent[0]?.text).toContain('AI says hi');
      expect(core.sent.some((message) => message.text === 'Gateway AI is looking at this')).toBe(
        false,
      );
    });

    function startedSize(): number {
      return gateway?.size() ?? 0;
    }
  });
});
