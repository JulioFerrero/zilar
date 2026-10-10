import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { FetchLike } from '../ai/litellm-client';
import { createKeyCipher } from '../connections/crypto';
import type { ActionGateway, RequestOutcome } from '../actions/gateway';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { stopAi, type AiServiceDeps } from '../ais/service';
import { type AgentGateway } from './gateway';
import { createDraftHub, type DraftHub } from '../drafts/hub';
import type { DraftHubEvent } from '../drafts/events';
import { BUDGET_EXCEEDED_REPLY, TRANSIENT_FAILURE_REPLY } from './reply';
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

  const { harness, coreFor } = createGatewayHelpers({
    getContext: () => context,
    setGateway: (created) => {
      gateway = created;
    },
  });

  describe('request_action tool', () => {
    interface RecordedRequest {
      aiId: string;
      groupId?: string;
      action: string;
      args: unknown;
      requestedBy: string;
    }

    function requestActionScriptedFetch(responses: Response[]): {
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

    function fakeActionGateway(outcome: RequestOutcome): {
      gateway: ActionGateway;
      requests: RecordedRequest[];
    } {
      const requests: RecordedRequest[] = [];
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

    function requestActionResponse(args: unknown, secondContent = 'AI follow-up'): Response[] {
      return [
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
                      arguments: JSON.stringify(args),
                    },
                  },
                ],
              },
            },
          ],
        }),
        completionResponse(secondContent),
      ];
    }

    it('routes a tier-2 request_action through the action gateway with session-derived ids', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl } = requestActionScriptedFetch(
        requestActionResponse({ action: 'demo.echo', args: { text: 'hi' } }),
      );
      const fake = fakeActionGateway({ status: 'pending_approval', approvalId: 'appr-1' });
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm(), {
        actions: fake.gateway,
      });
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'echo hi'));
      await waitFor(() => fake.requests.length === 1);

      expect(fake.requests[0]).toEqual({
        aiId: seeded.aiId,
        action: 'demo.echo',
        args: { text: 'hi' },
        requestedBy: seeded.aiJid,
      });
      expect(fake.requests[0]?.groupId).toBeUndefined();
      await waitFor(() => core.sent.length === 1);
      // The model sees the fixed "waiting for your owner's approval" line.
      expect(core.sent[0]?.text).toBe('AI follow-up');
    });

    it('cannot be tricked by an aiId or groupId smuggled inside args', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const smuggledArgs = {
        action: 'demo.echo',
        args: {
          text: 'hi',
          aiId: 'attacker-ai-id',
          groupId: 'attacker-group-id',
        },
      };
      const { fetchImpl } = requestActionScriptedFetch(requestActionResponse(smuggledArgs));
      const fake = fakeActionGateway({ status: 'pending_approval', approvalId: 'appr-2' });
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm(), {
        actions: fake.gateway,
      });
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'echo hi'));
      await waitFor(() => fake.requests.length === 1);

      // Top-level ids still come from the session; the smuggled keys stay
      // inside `args` where the adapter's zod schema decides whether they
      // belong.
      expect(fake.requests[0]?.aiId).toBe(seeded.aiId);
      expect(fake.requests[0]?.groupId).toBeUndefined();
      expect(fake.requests[0]?.args).toEqual({
        text: 'hi',
        aiId: 'attacker-ai-id',
        groupId: 'attacker-group-id',
      });
      expect(fake.requests[0]?.requestedBy).toBe(seeded.aiJid);
      void core;
    });

    it('maps every RequestOutcome to the model-facing wording (no adapter error text)', async () => {
      const outcomes: Array<{ outcome: RequestOutcome; expectedContent: string }> = [
        {
          outcome: { status: 'executed', summary: 'Echoed: hi' },
          expectedContent: 'done: Echoed: hi',
        },
        {
          outcome: { status: 'pending_approval', approvalId: 'appr-3' },
          expectedContent: "waiting for your owner's approval; a card was posted in this chat",
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
        const seeded = await seedAi(context);
        const cores: FakeCore[] = [];
        const { fetchImpl, calls } = requestActionScriptedFetch(
          requestActionResponse({ action: 'demo.echo', args: { text: 'hi' } }),
        );
        const fake = fakeActionGateway(outcome);
        const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm(), {
          actions: fake.gateway,
        });
        await started.start();
        const core = await coreFor(cores, seeded.aiJid);

        core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'echo hi'));
        await waitFor(() => calls.length === 2);
        const second = JSON.parse(String(calls[1]!.init.body)) as {
          messages: Array<{ role: string; content: string }>;
        };
        const toolMessage = second.messages.find((message) => message.role === 'tool');
        expect(toolMessage?.content).toBe(expectedContent);
        // No adapter text leaks into logs.
        const everything = JSON.stringify({ calls, toolMessage });
        expect(everything).not.toContain('SECRET-DO-NOT-LOG');
      }
    });

    it('appends an executed modelText as a labelled untrusted block', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = requestActionScriptedFetch(
        requestActionResponse({ action: 'demo.echo', args: { text: 'hi' } }),
      );
      const fake = fakeActionGateway({
        status: 'executed',
        summary: 'Echoed: hi',
        modelText: 'the tool said hello',
      });
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm(), {
        actions: fake.gateway,
      });
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'echo hi'));
      await waitFor(() => calls.length === 2);
      const second = JSON.parse(String(calls[1]!.init.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      const toolMessage = second.messages.find((message) => message.role === 'tool');
      expect(toolMessage?.content).toBe(
        'done: Echoed: hi\n\n<untrusted-tool-output>\nthe tool said hello\n</untrusted-tool-output>',
      );
    });

    it('a stopped AI answers "the AI was stopped" and never calls the action gateway', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const fetchImpl: FetchLike = () =>
        gate.then(() =>
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
        );
      const fake = fakeActionGateway({ status: 'executed', summary: 'Echoed: hi' });
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm(), {
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

      // Drive the message into the gateway and stop the AI before the LLM
      // call resolves, so the executor runs against a stopped session.
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'echo hi'));
      await stopAi(deps, seeded.aiId, seeded.ownerId);
      await waitFor(() => started.size() === 0);
      // Now release the LLM call: the in-flight turn sees `sessionIsLive`
      // false and answers "the AI was stopped" without invoking the action
      // gateway.
      release();
      await tick(200);

      expect(fake.requests).toHaveLength(0);
      expect(core.sent).toHaveLength(0);
    });

    it('without actions: the tool is not offered and a request_action call answers invalid', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = requestActionScriptedFetch([
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
        completionResponse('noted'),
      ]);
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      // The persona and memory tools are sent on both calls (no
      // request_action).
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'echo hi'));
      await waitFor(() => calls.length === 2);
      for (const call of calls) {
        const body = JSON.parse(String(call.init.body)) as {
          tools: Array<{ function: { name: string } }>;
        };
        expect(body.tools.map((tool) => tool.function.name).sort()).toEqual([
          'memory_zoom',
          'recall',
          'remember',
          'revert_persona',
          'update_persona',
        ]);
      }
      const second = JSON.parse(String(calls[1]!.init.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      const toolMessage = second.messages.find((message) => message.role === 'tool');
      expect(toolMessage?.content).toMatch(/^invalid: /);
    });

    it('a throwing action gateway is logged but the turn still gets a fixed failure text', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = requestActionScriptedFetch(
        requestActionResponse({ action: 'demo.echo', args: { text: 'hi' } }),
      );
      const throwingGateway: ActionGateway = {
        request: () => Promise.reject(new Error('SECRET-DO-NOT-LOG')),
        onApprovalDecided: () => Promise.resolve(),
        recoverStuck: () => Promise.resolve(),
        listActions: () => [{ name: 'demo.echo', description: 'Repeats text.' }],
      };
      const { gateway: started, logger } = harness(cores, fetchImpl, new FakeLitellm(), {
        actions: throwingGateway,
      });
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'echo hi'));
      await waitFor(() => calls.length === 2);
      const second = JSON.parse(String(calls[1]!.init.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      const toolMessage = second.messages.find((message) => message.role === 'tool');
      expect(toolMessage?.content).toBe('the action failed');
      const dumped = JSON.stringify({ calls, toolMessage, loggerCalls: logger.calls });
      expect(dumped).not.toContain('SECRET-DO-NOT-LOG');
    });
  });

  describe('streaming drafts', () => {
    const encoder = new TextEncoder();

    function sseResponse(chunks: string[]): Response {
      const encoded = chunks.map((chunk) => encoder.encode(chunk));
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const part of encoded) {
              controller.enqueue(part);
            }
            controller.close();
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    }

    function textChunk(content: string): string {
      return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
    }

    function toolChunk(callId: string, args: unknown): string {
      return `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: callId,
                  function: { name: 'update_persona', arguments: JSON.stringify(args) },
                },
              ],
            },
          },
        ],
      })}\n\n`;
    }

    const DONE = 'data: [DONE]\n\n';

    function sseFetch(responses: Response[]): { fetchImpl: FetchLike; calls: Call[] } {
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

    async function draftsSetup(responses: Response[]): Promise<{
      seeded: SeededAi;
      core: FakeCore;
      hub: DraftHub;
      events: DraftHubEvent[];
      strangerEvents: DraftHubEvent[];
      logger: ReturnType<typeof captureLogger>;
    }> {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const hub = createDraftHub();
      const events: DraftHubEvent[] = [];
      const strangerEvents: DraftHubEvent[] = [];
      hub.subscribe(seeded.ownerId, (event) => events.push(event));
      hub.subscribe('some-other-user', (event) => strangerEvents.push(event));
      const { fetchImpl } = sseFetch(responses);
      const { gateway: started, logger } = harness(cores, fetchImpl, new FakeLitellm(), { hub });
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);
      return { seeded, core, hub, events, strangerEvents, logger };
    }

    function draftsOf(events: DraftHubEvent[]): DraftHubEvent[] {
      return events.filter((event) => event.type === 'draft');
    }

    it('streams drafts while the model writes and ends sent after the DM', async () => {
      const { seeded, core, events, strangerEvents } = await draftsSetup([
        sseResponse([textChunk('Hello'), textChunk(', Julio'), DONE]),
      ]);

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'hello'));
      await waitFor(() => events.some((event) => event.type === 'end'));

      // The final XMPP message is already out by the time `end` arrives.
      expect(core.sent).toEqual([{ to: seeded.ownerJid, kind: 'chat', text: 'Hello, Julio' }]);
      const turnId = events[0]?.type === 'draft' ? events[0].turnId : undefined;
      expect(turnId).toBeDefined();
      expect(events.at(-1)).toEqual({
        type: 'end',
        chatJid: seeded.aiJid,
        turnId,
        outcome: 'sent',
      });
      for (const event of events) {
        expect(event.chatJid).toBe(seeded.aiJid);
        if (event.type === 'draft' || event.type === 'end') {
          expect(event.turnId).toBe(turnId);
        }
      }
      const texts = draftsOf(events).map((event) => (event.type === 'draft' ? event.text : ''));
      expect(texts.length).toBeGreaterThanOrEqual(1);
      expect(texts.at(-1)).toBe('Hello, Julio');
      expect(strangerEvents).toHaveLength(0);
      // Typing still works for clients without drafts.
      expect(core.typing).toEqual([
        { to: seeded.ownerJid, kind: 'chat', state: 'composing' },
        { to: seeded.ownerJid, kind: 'chat', state: 'paused' },
      ]);
    });

    it('collapses a burst of deltas to at most 2 drafts, last equals the full text', async () => {
      let full = '';
      const chunks: string[] = [];
      for (let i = 0; i < 50; i += 1) {
        full += `word${i} `;
        chunks.push(textChunk(`word${i} `));
      }
      chunks.push(DONE);
      const { seeded, core, events } = await draftsSetup([sseResponse(chunks)]);

      // Fake timers: the throttle is time-based, so virtual time keeps this
      // deterministic instead of CI-speed-dependent. The turn itself is
      // promise-driven and drains inside the first advances, well before the
      // 150 ms throttle timer could fire a third draft.
      vi.useFakeTimers();
      try {
        core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'tell me a story'));
        for (let i = 0; i < 100 && !events.some((event) => event.type === 'end'); i += 1) {
          await vi.advanceTimersByTimeAsync(10);
        }
        expect(events.some((event) => event.type === 'end')).toBe(true);
      } finally {
        vi.useRealTimers();
      }

      expect(core.sent[0]?.text).toBe(full.trim());
      const drafts = draftsOf(events);
      expect(drafts.length).toBeLessThanOrEqual(2);
      const last = drafts.at(-1);
      // The flush before the final send publishes the exact trimmed reply,
      // so the last draft equals the DM text (not the raw untrimmed tail).
      expect(last?.type === 'draft' ? last.text : '').toBe(full.trim());
      expect(events.at(-1)?.type).toBe('end');
    });

    it('flushes the complete text as a draft before the final XMPP send', async () => {
      // Every delta lands in one synchronous burst, so the tail is still
      // sitting in the throttle window when the turn ends.
      const parts = ['Hello, ', 'Julio, ', 'here is ', 'the whole tail.'];
      const full = parts.join('');
      const { seeded, core, hub, events } = await draftsSetup([
        sseResponse([...parts.map((part) => textChunk(part)), DONE]),
      ]);
      const order: string[] = [];
      hub.subscribe(seeded.ownerId, (event) => {
        order.push(event.type === 'draft' ? `draft:${event.text}` : `end:${event.outcome}`);
      });
      const send = core.sendMessage.bind(core);
      core.sendMessage = async (to, kind, text) => {
        order.push(`send:${text}`);
        return send(to, kind, text);
      };

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'tell me everything'));
      await waitFor(() => order.some((entry) => entry.startsWith('end:')));

      expect(core.sent).toEqual([{ to: seeded.ownerJid, kind: 'chat', text: full }]);
      const sendIndex = order.findIndex((entry) => entry.startsWith('send:'));
      const lastDraftIndex = order.reduce(
        (last, entry, index) => (entry.startsWith('draft:') ? index : last),
        -1,
      );
      expect(lastDraftIndex).toBeGreaterThanOrEqual(0);
      expect(lastDraftIndex).toBeLessThan(sendIndex);
      expect(order[lastDraftIndex]).toBe(`draft:${full}`);
      expect(order.at(-1)).toBe('end:sent');
      expect(events.at(-1)).toMatchObject({ type: 'end', outcome: 'sent' });
    });

    it('never puts tool-call arguments in a draft', async () => {
      const secretArgs = {
        persona: `brand new persona nobody may see ${randomUUID()}`,
        summary: 'Spanish answers',
      };
      const { seeded, core, events, logger } = await draftsSetup([
        sseResponse([toolChunk('call-1', secretArgs), DONE]),
        sseResponse([textChunk('vale'), DONE]),
      ]);

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'answer in Spanish'));
      await waitFor(() => events.some((event) => event.type === 'end'));

      expect(core.sent[0]?.text).toBe(
        'vale\n\n✏️ Persona updated: Spanish answers. Say "undo" to revert.',
      );
      const draftText = draftsOf(events)
        .map((event) => (event.type === 'draft' ? event.text : ''))
        .join('\n');
      expect(draftText).not.toContain(secretArgs.persona);
      expect(draftText).not.toContain('update_persona');
      const logged = loggedText(logger.calls);
      expect(`${logged}\n${JSON.stringify(core.sent)}`).not.toContain(VIRTUAL_KEY);
      expect(`${logged}\n${JSON.stringify(events)}`).not.toContain(secretArgs.persona);
    });

    it('sends the failure text and end failed when the stream breaks midway', async () => {
      const broken = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(textChunk('half ')));
            controller.error(new Error(`socket reset, key was ${VIRTUAL_KEY}`));
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
      const { seeded, core, events, logger } = await draftsSetup([broken]);

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'hello'));
      await waitFor(() => events.some((event) => event.type === 'end'));

      expect(core.sent).toEqual([
        { to: seeded.ownerJid, kind: 'chat', text: TRANSIENT_FAILURE_REPLY },
      ]);
      expect(events.at(-1)).toMatchObject({ type: 'end', outcome: 'failed' });
      const logged = loggedText(logger.calls);
      expect(logged).not.toContain(VIRTUAL_KEY);
      expect(logged).not.toContain(MASTER_KEY);
      expect(logged).not.toContain(PROVIDER_KEY);
      expect(JSON.stringify(events)).not.toContain(VIRTUAL_KEY);
    });

    it('sends the limit text and end failed on a 429 before the stream', async () => {
      const { seeded, core, events } = await draftsSetup([
        jsonResponse({ error: { message: 'over budget' } }, 429),
      ]);

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'hello'));
      await waitFor(() => events.some((event) => event.type === 'end'));

      expect(core.sent).toEqual([
        { to: seeded.ownerJid, kind: 'chat', text: BUDGET_EXCEEDED_REPLY },
      ]);
      expect(draftsOf(events)).toHaveLength(0);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: 'end', outcome: 'failed' });
    });

    it('publishes end failed only after the failure DM is sent', async () => {
      const seeded = await seedAi(context);
      // No virtual key row: the turn fails before any model work.
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`DELETE FROM llm_virtual_keys WHERE ai_id = ${seeded.aiId}`;
        }),
      );
      const cores: FakeCore[] = [];
      const hub = createDraftHub();
      const order: string[] = [];
      hub.subscribe(seeded.ownerId, (event) => {
        if (event.type === 'end') {
          order.push('end');
        }
      });
      const { fetchImpl } = sseFetch([completionResponse('never used')]);
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm(), { hub });
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);
      const send = core.sendMessage.bind(core);
      core.sendMessage = async (to, kind, text) => {
        order.push('send');
        return send(to, kind, text);
      };

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'hello'));
      await waitFor(() => order.length === 2);

      expect(order).toEqual(['send', 'end']);
      expect(core.sent).toEqual([
        { to: seeded.ownerJid, kind: 'chat', text: TRANSIENT_FAILURE_REPLY },
      ]);
    });
  });
});
