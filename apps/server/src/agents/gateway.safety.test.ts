import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
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
import { localpartFor } from '../xmpp/provisioning';
import { resumeAi, stopAi, type AiServiceDeps } from '../ais/service';
import { type AgentGateway } from './gateway';
import {
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

  const { harness, completionFetch, coreFor } = createGatewayHelpers({
    getContext: () => context,
    setGateway: (created) => {
      gateway = created;
    },
  });

  // T-0080: the kill switch. Every test in this block drives `stopAi` /
  // `resumeAi` through their service entry points so the gateway observes
  // the same lifecycle events it would in production. The core is a fake
  // (no real ejabberd), but the gateway's react to the events is what we
  // are testing: every send path a running AI turn triggers is gated by
  // `liveSendMessage` / `liveSendTyping` / `liveMarkDisplayed`, so a stop
  // that lands between the LLM call and the final send drops the reply
  // (and every draft) instead of delivering it.
  describe('kill switch (T-0080)', () => {
    async function stoppableSetup(): Promise<{
      seeds: SeededAi[];
      cores: FakeCore[];
      calls: Call[];
      gateway: AgentGateway;
      deps: AiServiceDeps;
    }> {
      const a = await seedAi(context);
      const b = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = completionFetch();
      const litellm = new FakeLitellm();
      const { gateway: started } = harness(cores, fetchImpl, litellm);
      await started.start();
      const aiDeps: AiServiceDeps = {
        db: context.db,
        adminClient: context.adminClient,
        litellm,
        cipher: createKeyCipher(MASTER_KEY),
        logger: context.logger,
        domain: context.xmppConfig.domain,
      };
      return { seeds: [a, b], cores, calls, gateway: started, deps: aiDeps };
    }

    // A fetch that resolves only when `release()` is called, so the test
    // can park the gateway between the LLM call and the final send.
    function pausedFetch(text: string): {
      fetchImpl: FetchLike;
      calls: Call[];
      release: () => void;
    } {
      const calls: Call[] = [];
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const fetchImpl: FetchLike = (url, init) => {
        calls.push({ url, init });
        return gate.then(() => completionResponse(text));
      };
      return { fetchImpl, calls, release };
    }

    it('disconnects an AI stopped after start at once and keeps it offline across reconcile', async () => {
      const { seeds, cores, gateway, deps } = await stoppableSetup();
      const first = seeds[0]!;
      const second = seeds[1]!;
      expect(gateway.size()).toBe(2);
      const firstCore = await coreFor(cores, first.aiJid);
      const secondCore = await coreFor(cores, second.aiJid);

      // Stop the first AI. The notifier path disconnects it at once; the
      // other AI is untouched.
      await stopAi(deps, first.aiId, first.ownerId);
      await waitFor(() => gateway.size() === 1);
      expect(gateway.aiIds()).toEqual([second.aiId]);
      expect(firstCore.disconnects).toBe(1);

      // The stopped row is no longer in `listActiveAisForGateway`, so a
      // reconcile never reconnects it.
      await gateway.reconcile();
      await tick(50);
      expect(gateway.size()).toBe(1);
      expect(firstCore.connects).toBe(1);

      // The other AI still answers.
      secondCore.receive(incoming(second.aiJid, second.ownerJid, 'm-1', 'hello'));
      await waitFor(() => secondCore.sent.length === 1);
      expect(secondCore.sent[0]).toEqual({ to: second.ownerJid, kind: 'chat', text: 'AI says hi' });
    });

    it('a reply in flight when the stop arrives is dropped, not delivered', async () => {
      const first = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl, calls, release } = pausedFetch('AI says hi');
      const litellm = new FakeLitellm();
      const { gateway: started } = harness(cores, fetchImpl, litellm);
      await started.start();
      const core = await coreFor(cores, first.aiJid);
      const deps: AiServiceDeps = {
        db: context.db,
        adminClient: context.adminClient,
        litellm,
        cipher: createKeyCipher(MASTER_KEY),
        logger: context.logger,
        domain: context.xmppConfig.domain,
      };

      core.receive(incoming(first.aiJid, first.ownerJid, 'm-1', 'hello'));
      await waitFor(() => calls.length === 1);

      // Stop while the LLM call is still parked. The notifier path
      // disconnects the AI immediately; the pump is mid-turn.
      await stopAi(deps, first.aiId, first.ownerId);
      await waitFor(() => started.size() === 0);

      // Releasing the LLM call lets the in-flight turn finish computing,
      // yet `liveSendMessage` drops the reply.
      release();
      await tick(200);
      expect(core.sent.find((message) => message.text === 'AI says hi')).toBeUndefined();
      expect(core.disconnects).toBe(1);
    });

    it('a persona change requested by a turn that was running when the stop arrived is not applied', async () => {
      const first = await seedAi(context);
      const cores: FakeCore[] = [];
      const calls: Call[] = [];
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const fetchImpl: FetchLike = (url, init) => {
        calls.push({ url, init });
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
                        name: 'update_persona',
                        arguments: JSON.stringify({
                          persona: 'A persona set after the stop.',
                          summary: 'Changed after stop',
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
      const litellm = new FakeLitellm();
      const { gateway: started } = harness(cores, fetchImpl, litellm);
      await started.start();
      const core = await coreFor(cores, first.aiJid);
      const deps: AiServiceDeps = {
        db: context.db,
        adminClient: context.adminClient,
        litellm,
        cipher: createKeyCipher(MASTER_KEY),
        logger: context.logger,
        domain: context.xmppConfig.domain,
      };

      core.receive(incoming(first.aiJid, first.ownerJid, 'm-1', 'change your persona'));
      await waitFor(() => calls.length === 1);
      await stopAi(deps, first.aiId, first.ownerId);
      await waitFor(() => started.size() === 0);

      release();
      await tick(200);
      const [row] = await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{ persona: string }>`SELECT persona FROM ais
            WHERE id = ${first.aiId}`;
        }),
      );
      expect(row?.persona).toBe('A helpful persona.');
    });

    it('queued, not-yet-started turns are dropped when a stop arrives', async () => {
      const first = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl, calls, release } = pausedFetch('reply one');
      const litellm = new FakeLitellm();
      const { gateway: started } = harness(cores, fetchImpl, litellm);
      await started.start();
      const core = await coreFor(cores, first.aiJid);
      const deps: AiServiceDeps = {
        db: context.db,
        adminClient: context.adminClient,
        litellm,
        cipher: createKeyCipher(MASTER_KEY),
        logger: context.logger,
        domain: context.xmppConfig.domain,
      };

      // First turn holds the pump busy: every subsequent receive coalesces
      // into `pending`. The LLM call never resolves until `release()`.
      core.receive(incoming(first.aiJid, first.ownerJid, 'm-1', 'one'));
      await waitFor(() => calls.length === 1);
      core.receive(incoming(first.aiJid, first.ownerJid, 'm-2', 'two'));
      core.receive(incoming(first.aiJid, first.ownerJid, 'm-3', 'three'));

      // Stop the AI: the pump's `while (... && !session.stopped)` exits,
      // and `disconnectAi` clears `session.pending`.
      await stopAi(deps, first.aiId, first.ownerId);
      await waitFor(() => started.size() === 0);

      // Release the in-flight call so any continuation that did sneak in
      // can resolve; the only LLM call was the first one and it must not
      // produce a second one for the queued messages.
      release();
      await tick(200);
      expect(calls).toHaveLength(1);
      // No DM was delivered (the session was disconnected).
      expect(core.sent).toHaveLength(0);
    });

    it('a message to a stopped AI gets no answer', async () => {
      const { seeds, cores, calls, gateway, deps } = await stoppableSetup();
      const first = seeds[0]!;
      const second = seeds[1]!;
      await stopAi(deps, first.aiId, first.ownerId);
      await waitFor(() => gateway.size() === 1);

      const firstCore = await coreFor(cores, first.aiJid);
      // The XMPP core for the stopped AI is gone (disconnected), so its
      // fake `receive` no longer feeds a live pump. The gateway itself
      // does not deliver turns for the stopped AI on incoming messages
      // because it is no longer connected. Here we simulate by driving
      // the model path directly: there must be no model call for the
      // stopped AI.
      const callsBefore = calls.length;
      firstCore.receive(incoming(first.aiJid, first.ownerJid, 'm-1', 'hello'));
      await tick(200);
      expect(calls.length).toBe(callsBefore);
      expect(firstCore.sent).toHaveLength(0);

      // The other AI is unaffected.
      const secondCore = await coreFor(cores, second.aiJid);
      secondCore.receive(incoming(second.aiJid, second.ownerJid, 'm-1', 'hi'));
      await waitFor(() => secondCore.sent.length === 1);
      expect(secondCore.sent[0]).toEqual({ to: second.ownerJid, kind: 'chat', text: 'AI says hi' });
    });

    it('resume brings a stopped AI back and it answers', async () => {
      const { seeds, cores, gateway, deps } = await stoppableSetup();
      const first = seeds[0]!;
      await stopAi(deps, first.aiId, first.ownerId);
      await waitFor(() => gateway.size() === 1);

      const coresBefore = cores.length;
      await resumeAi(deps, first.aiId, first.ownerId);
      await waitFor(() => gateway.size() === 2);
      // A fresh XMPP connection was created on resume (the original one
      // was disconnected by stop). `cores` now has one entry per connect.
      expect(cores.length).toBeGreaterThan(coresBefore);
      const live = cores[cores.length - 1] as FakeCore;
      live.receive(incoming(first.aiJid, first.ownerJid, 'm-1', 'hello again'));
      await waitFor(() => live.sent.length === 1);
      expect(live.sent[0]).toEqual({ to: first.ownerJid, kind: 'chat', text: 'AI says hi' });
    });

    it('a "restart" — fresh gateway, fresh reconcile — leaves a stopped AI offline', async () => {
      const { seeds, gateway, deps } = await stoppableSetup();
      const first = seeds[0]!;
      const second = seeds[1]!;
      await stopAi(deps, first.aiId, first.ownerId);
      await waitFor(() => gateway.size() === 1);
      await gateway.stop();

      // Fresh gateway (simulates a server restart). The stopped AI's row
      // is still `stopped`, so the reconcile excludes it.
      const freshCores: FakeCore[] = [];
      const { fetchImpl: freshFetch, calls: freshCalls } = completionFetch('fresh');
      const litellm = new FakeLitellm();
      const { gateway: restarted } = harness(freshCores, freshFetch, litellm);
      await restarted.start();
      expect(restarted.size()).toBe(1);
      expect(restarted.aiIds()).toEqual([second.aiId]);
      // The stopped AI never gets a core allocated, no connect attempt.
      expect(freshCores).toHaveLength(1);
      const liveCore = freshCores[0]!;
      liveCore.receive(incoming(second.aiJid, second.ownerJid, 'm-1', 'hello'));
      await waitFor(() => liveCore.sent.length === 1);
      expect(liveCore.sent[0]).toEqual({ to: second.ownerJid, kind: 'chat', text: 'fresh' });
      // The fixture `calls` is from the original harness — confirm the
      // fresh one was driven.
      expect(freshCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // T-0092: the action gateway uses this to post the approval card and
  // outcome notices into the AI's own chat. The kill-switch semantics live
  // here too: a stopped AI, an unknown AI, or an AI that was never in the
  // room must answer `false` and send nothing.
  describe('postToChat (T-0092)', () => {
    async function seedMemberLocal(name: string): Promise<{ userId: string; jid: string }> {
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

    async function seedGroupLocal(input: {
      ownerId: string;
      aiId: string;
      memberIds?: string[];
    }): Promise<{ groupId: string; roomJid: string }> {
      const groupId = randomUUID();
      const roomLocalpart = `gpost${randomUUID().replace(/-/g, '').slice(0, 9)}`;
      const localTopicId = randomUUID();
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
            id: localTopicId,
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

    it('sends one groupchat to the room JID for a group with a payload', async () => {
      const seeded = await seedAi(context);
      const member = await seedMemberLocal('Ana');
      const { groupId, roomJid } = await seedGroupLocal({
        ownerId: seeded.ownerId,
        aiId: seeded.aiId,
        memberIds: [member.userId],
      });
      const cores: FakeCore[] = [];
      const { fetchImpl } = completionFetch();
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);
      const payload = {
        v: 0 as const,
        type: 'approval.request' as const,
        data: {
          id: 'approval-1',
          room: roomJid,
          ai: seeded.aiJid,
          action: 'demo.echo',
          summary: 'Echo',
          args_hash: 'a'.repeat(64),
          requested_by: member.jid,
          expires_at: '2026-12-01T12:00:00.000Z',
        },
      };
      const ok = await started.postToChat({
        aiId: seeded.aiId,
        groupId,
        text: 'Approval needed: Echo',
        payload,
      });
      expect(ok).toBe(true);
      expect(core.sent).toEqual([
        {
          to: roomJid,
          kind: 'groupchat',
          text: 'Approval needed: Echo',
          opts: { payload },
        },
      ]);
    });

    it('sends a chat to the owner JID for a DM (groupId null)', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl } = completionFetch();
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);
      const ok = await started.postToChat({
        aiId: seeded.aiId,
        groupId: null,
        text: 'Done: Echo',
      });
      expect(ok).toBe(true);
      expect(core.sent).toEqual([
        { to: seeded.ownerJid, kind: 'chat', text: 'Done: Echo', opts: {} },
      ]);
    });

    it('returns false and sends nothing for an unknown AI', async () => {
      const cores: FakeCore[] = [];
      const { fetchImpl } = completionFetch();
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const ok = await started.postToChat({
        aiId: 'no-such-ai',
        groupId: null,
        text: 'hi',
      });
      expect(ok).toBe(false);
      for (const core of cores) {
        expect(core.sent).toEqual([]);
      }
    });

    it('returns false and sends nothing for a stopped AI', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl } = completionFetch();
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);
      const initialSentLength = core.sent.length;

      // Stop the AI through the service entry point: the gateway observes
      // the lifecycle event and disconnects the session, just like a real
      // kill switch would.
      const deps: AiServiceDeps = {
        db: context.db,
        adminClient: context.adminClient,
        litellm: new FakeLitellm(),
        cipher: createKeyCipher(MASTER_KEY),
        logger: context.logger,
        domain: context.xmppConfig.domain,
      };
      await stopAi(deps, seeded.aiId, seeded.ownerId);
      await waitFor(() => started.size() === 0);

      const ok = await started.postToChat({
        aiId: seeded.aiId,
        groupId: null,
        text: 'after-stop',
      });
      expect(ok).toBe(false);
      expect(core.sent.length).toBe(initialSentLength);
    });

    it('returns false for a group post when the AI never joined the room', async () => {
      const seeded = await seedAi(context);
      // AI is not added to any group: the session has no rooms.
      const cores: FakeCore[] = [];
      const { fetchImpl } = completionFetch();
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);
      const ok = await started.postToChat({
        aiId: seeded.aiId,
        groupId: 'some-group',
        text: 'hello room',
      });
      expect(ok).toBe(false);
      expect(core.sent).toEqual([]);
    });
  });

  // T-0106: the tool guide rides the turn only when tools are enabled and
  // adapters are registered; multi-round turns post one live progress
  // message and update it per round.
  describe('tool guide and progress (T-0106)', () => {
    function scriptedFetchLocal(responses: Response[]): {
      fetchImpl: FetchLike;
      calls: Call[];
    } {
      const calls: Call[] = [];
      let index = 0;
      const fetchImpl: FetchLike = (url, init) => {
        calls.push({ url, init });
        const response = responses[Math.min(index, responses.length - 1)]!;
        index += 1;
        return Promise.resolve(response.clone());
      };
      return { fetchImpl, calls };
    }

    function fakeActionGatewayLocal(outcome: RequestOutcome): {
      gateway: ActionGateway;
      requests: Array<Record<string, unknown>>;
    } {
      const requests: Array<Record<string, unknown>> = [];
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

    function guideResponse(
      calls: Array<{ id: string; name: string; args: unknown }>,
      followUp = 'AI follow-up',
    ): Response[] {
      return [
        jsonResponse({
          choices: [
            {
              message: {
                content: null,
                tool_calls: calls.map((call) => ({
                  id: call.id,
                  type: 'function',
                  function: { name: call.name, arguments: JSON.stringify(call.args) },
                })),
              },
            },
          ],
        }),
        completionResponse(followUp),
      ];
    }

    it('appends the guide to the DM prompt only when tools are enabled with adapters', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const args = { action: 'demo.echo', args: { text: 'hi' } };
      const first = scriptedFetchLocal(
        guideResponse([{ id: 'call-1', name: 'request_action', args }]),
      );
      const fake = fakeActionGatewayLocal({ status: 'executed', summary: 'Echoed: hi' });
      const { gateway: started } = harness(cores, first.fetchImpl, new FakeLitellm(), {
        actions: fake.gateway,
        toolsEnabled: true,
      });
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'echo hi'));
      await waitFor(() => first.calls.length === 2);
      const body = JSON.parse(String(first.calls[0]!.init.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      const systemAndGuide = body.messages.filter((message) => message.role === 'user');
      expect(systemAndGuide.at(-1)?.content).toContain('`tool.list`');

      // Tools off: the same turn carries no guide.
      const coresOff: FakeCore[] = [];
      const second = scriptedFetchLocal(
        guideResponse([{ id: 'call-1', name: 'request_action', args }]),
      );
      const { gateway: off } = harness(coresOff, second.fetchImpl, new FakeLitellm(), {
        actions: fake.gateway,
      });
      await off.start();
      const coreOff = await coreFor(coresOff, seeded.aiJid);
      coreOff.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-2', 'echo hi'));
      await waitFor(() => second.calls.length === 2);
      const offBody = JSON.parse(String(second.calls[0]!.init.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      expect(offBody.messages.every((message) => !message.content.includes('`tool.list`'))).toBe(
        true,
      );
      await off.stop();
    });

    it('omits the guide when tools are on but no adapters are registered', async () => {
      // `toolsEnabled` with an empty action list offers no `request_action`
      // (see `buildTools`), so the guide — which documents that tool —
      // stays out too instead of inviting hallucinated calls.
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const args = { action: 'demo.echo', args: { text: 'hi' } };
      const { fetchImpl, calls } = scriptedFetchLocal(
        guideResponse([{ id: 'call-1', name: 'request_action', args }]),
      );
      const empty: ActionGateway = {
        request: () => Promise.resolve({ status: 'failed' }),
        onApprovalDecided: () => Promise.resolve(),
        recoverStuck: () => Promise.resolve(),
        listActions: () => [],
      };
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm(), {
        actions: empty,
        toolsEnabled: true,
      });
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'echo hi'));
      await waitFor(() => calls.length === 2);
      const body = JSON.parse(String(calls[0]!.init.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      expect(body.messages.every((message) => !message.content.includes('`tool.list`'))).toBe(true);
      await started.stop();
    });

    it('posts one progress message and corrects it on the next round', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = scriptedFetchLocal([
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
                      arguments: JSON.stringify({ action: 'tool.list', args: {} }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        jsonResponse({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call-2',
                    type: 'function',
                    function: {
                      name: 'request_action',
                      arguments: JSON.stringify({
                        action: 'web.price',
                        args: { symbols: ['BTC'] },
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        completionResponse('Done.'),
      ]);
      const fake = fakeActionGatewayLocal({ status: 'executed', summary: 'ok' });
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm(), {
        actions: fake.gateway,
        toolsEnabled: true,
        toolMaxRounds: 6,
      });
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'prices please'));
      await waitFor(() => calls.length === 3);
      await waitFor(() => core.sent.length >= 2);
      // One progress post, one correction to the next fixed stage, and a
      // retraction once the final text lands. Stages never carry model text.
      const progressPosts = core.sent.filter(
        (message) =>
          typeof message.opts === 'object' &&
          message.opts !== null &&
          (message.opts as { payload?: { type?: string } }).payload?.type === 'progress',
      );
      expect(progressPosts).toHaveLength(1);
      expect(progressPosts[0]?.text).toBe('Looking up saved tools');
      expect(core.corrections).toHaveLength(1);
      expect(core.corrections[0]?.text).toBe('Looking up prices');
      expect(core.retractions).toHaveLength(1);
      const final = core.sent.at(-1);
      expect(final?.text).toBe('Done.');
    });

    it('logs the per-turn tool counts line with ids and counts only (T-0156)', async () => {
      // The T-0106 counts line is wired in production: one DM turn with a
      // tool round logs one `AI tool turn finished` line carrying the AI id,
      // the round and call counts and the elapsed ms — never content.
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = scriptedFetchLocal(
        guideResponse([{ id: 'call-1', name: 'request_action', args: { action: 'x', args: {} } }]),
      );
      const fake = fakeActionGatewayLocal({ status: 'executed', summary: 'ok' });
      const turnInfos: Array<{ fields: Record<string, unknown>; message: string }> = [];
      const { gateway: started, logger } = harness(cores, fetchImpl, new FakeLitellm(), {
        actions: fake.gateway,
        toolsEnabled: true,
        turnLogger: {
          info: (fields, message) => {
            turnInfos.push({ fields, message });
          },
          warn: () => undefined,
        },
      });
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'look this up'));
      await waitFor(() => calls.length === 2);
      await waitFor(() => turnInfos.length === 1);
      expect(turnInfos[0]?.message).toBe('AI tool turn finished');
      // Default `maxRounds: 1`: round 1 offers tools and executes, then the
      // legacy follow-up answers in text — one counted round, one call.
      expect(turnInfos[0]?.fields).toMatchObject({
        aiId: seeded.aiId,
        rounds: 1,
        toolCalls: 1,
      });
      expect(typeof turnInfos[0]?.fields['elapsedMs']).toBe('number');
      const serialised = `${JSON.stringify(turnInfos)}\n${JSON.stringify(logger.calls)}`;
      expect(serialised).not.toContain('look this up');
      await started.stop();
    });
  });
});
