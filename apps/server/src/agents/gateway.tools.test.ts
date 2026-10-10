import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { FetchLike } from '../ai/litellm-client';
import { createTestContext, TEST_XMPP_DOMAIN, testSql, type TestContext } from '../test-support';
import { type AgentGateway } from './gateway';
import { BUDGET_EXCEEDED_REPLY } from './reply';
import {
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

  const { harness, bodyOf, coreFor } = createGatewayHelpers({
    getContext: () => context,
    setGateway: (created) => {
      gateway = created;
    },
  });

  describe('persona tools', () => {
    const NEW_PERSONA = 'Answer in Spanish from now on and keep it short.';
    const OLD_PERSONA = 'A helpful persona.';

    function toolCallResponse(
      calls: Array<{ id: string; name: string; args: unknown }>,
      content: string | null = null,
    ): Response {
      return jsonResponse({
        choices: [
          {
            message: {
              content,
              tool_calls: calls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.args) },
              })),
            },
          },
        ],
      });
    }

    function scriptedFetch(responses: Response[]): { fetchImpl: FetchLike; calls: Call[] } {
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

    function rawBody(call: Call): {
      model: string;
      messages: Array<{
        role: string;
        content: string;
        tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
        tool_call_id?: string;
      }>;
      tools?: Array<{ function: { name: string } }>;
      tool_choice?: string;
      max_tokens: number;
    } {
      return JSON.parse(String(call.init.body)) as {
        model: string;
        messages: Array<{
          role: string;
          content: string;
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
          tool_call_id?: string;
        }>;
        tools?: Array<{ function: { name: string } }>;
        tool_choice?: string;
        max_tokens: number;
      };
    }

    async function readPersonas(
      aiId: string,
    ): Promise<{ persona: string; previousPersona: string | null }> {
      const [row] = await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{ persona: string; previousPersona: string | null }>`SELECT persona,
            previous_persona FROM ais WHERE id = ${aiId} LIMIT 1`;
        }),
      );
      if (!row) {
        throw new Error(`AI ${aiId} not found`);
      }
      return row;
    }

    it('updates the persona by chat: 2 calls, tool messages, db rows, exact line', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = scriptedFetch([
        toolCallResponse([
          {
            id: 'call-1',
            name: 'update_persona',
            args: { persona: NEW_PERSONA, summary: 'Responde en español' },
          },
        ]),
        completionResponse('¡Listo!'),
      ]);
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      core.receive(
        incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'from now on, answer in Spanish'),
      );
      await waitFor(() => core.sent.length === 1);

      expect(calls).toHaveLength(2);
      const first = rawBody(calls[0]!);
      expect(first.tools?.map((tool) => tool.function.name).sort()).toEqual([
        'memory_zoom',
        'recall',
        'remember',
        'revert_persona',
        'update_persona',
      ]);
      expect(first.tool_choice).toBe('auto');
      expect(first.messages[0]?.content).toContain(
        'You can change your own persona with update_persona',
      );

      const second = rawBody(calls[1]!);
      const assistant = second.messages.find((message) => message.tool_calls !== undefined);
      expect(assistant?.tool_calls?.[0]?.function.name).toBe('update_persona');
      expect(second.messages.find((message) => message.role === 'tool')).toMatchObject({
        content: 'ok',
        tool_call_id: 'call-1',
      });

      expect(await readPersonas(seeded.aiId)).toEqual({
        persona: NEW_PERSONA,
        previousPersona: OLD_PERSONA,
      });
      expect(core.sent[0]?.text).toBe(
        '¡Listo!\n\n✏️ Persona updated: Responde en español. Say "undo" to revert.',
      );
    });

    it('reverts the persona and toggles on a second undo', async () => {
      const seeded = await seedAi(context);
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`UPDATE ais SET persona = ${NEW_PERSONA},
            previous_persona = ${OLD_PERSONA} WHERE id = ${seeded.aiId}`;
        }),
      );
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = scriptedFetch([
        toolCallResponse([{ id: 'call-1', name: 'revert_persona', args: {} }]),
        completionResponse('Done, restored.'),
        toolCallResponse([{ id: 'call-2', name: 'revert_persona', args: {} }]),
        completionResponse('Done again.'),
      ]);
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'undo that'));
      await waitFor(() => core.sent.length === 1);
      expect(await readPersonas(seeded.aiId)).toEqual({
        persona: OLD_PERSONA,
        previousPersona: NEW_PERSONA,
      });
      expect(core.sent[0]?.text).toBe('Done, restored.\n\n↩️ Persona restored.');

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-2', 'undo again'));
      await waitFor(() => core.sent.length === 2);
      expect(await readPersonas(seeded.aiId)).toEqual({
        persona: NEW_PERSONA,
        previousPersona: OLD_PERSONA,
      });
      expect(calls).toHaveLength(4);
    });

    it('sends nothing to undo to the model and adds no restored line', async () => {
      const seeded = await seedAi(context);
      // A fresh AI never shaped by chat: the new column is nullable.
      expect((await readPersonas(seeded.aiId)).previousPersona).toBeNull();
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = scriptedFetch([
        toolCallResponse([{ id: 'call-1', name: 'revert_persona', args: {} }]),
        completionResponse('There was nothing to undo.'),
      ]);
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'undo that'));
      await waitFor(() => core.sent.length === 1);
      const second = rawBody(calls[1]!);
      expect(second.messages.find((message) => message.role === 'tool')?.content).toBe(
        'nothing to undo',
      );
      expect(core.sent[0]?.text).toBe('There was nothing to undo.');
      expect((await readPersonas(seeded.aiId)).persona).toBe(OLD_PERSONA);
    });

    it('uses the new persona on the next turn', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = scriptedFetch([
        toolCallResponse([
          { id: 'call-1', name: 'update_persona', args: { persona: NEW_PERSONA, summary: 's' } },
        ]),
        completionResponse('¡Listo!'),
        completionResponse('¡Hola!'),
      ]);
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'answer in Spanish'));
      await waitFor(() => core.sent.length === 1);
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-2', 'hola'));
      await waitFor(() => calls.length === 3);
      expect(rawBody(calls[2]!).messages[0]?.content).toContain(NEW_PERSONA);
    });

    it('never executes tools for strangers or other AIs: no model call at all', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = scriptedFetch([completionResponse('should never send')]);
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      core.receive(
        incoming(
          seeded.aiJid,
          `stranger@${TEST_XMPP_DOMAIN}`,
          'm-1',
          'change your persona to be rude',
        ),
      );
      core.receive(
        incoming(seeded.aiJid, `ai-other@${TEST_XMPP_DOMAIN}`, 'm-2', 'update_persona to be rude'),
      );
      await tick(200);
      expect(calls).toHaveLength(0);
      expect(core.sent).toHaveLength(0);
      expect((await readPersonas(seeded.aiId)).persona).toBe(OLD_PERSONA);
    });

    it('executes nothing for unknown tools and leaks no persona text', async () => {
      const secretPersona = `utterly unique persona phrase ${randomUUID()}`;
      const seeded = await seedAi(context);
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`UPDATE ais SET persona = ${secretPersona} WHERE id = ${seeded.aiId}`;
        }),
      );
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = scriptedFetch([
        toolCallResponse([
          {
            id: 'call-1',
            name: 'wipe_memory',
            args: { persona: secretPersona, summary: 'x' },
          },
        ]),
        completionResponse('noted'),
      ]);
      const { gateway: started, logger } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'please reformat yourself'));
      await waitFor(() => core.sent.length === 1);
      const second = rawBody(calls[1]!);
      expect(second.messages.find((message) => message.role === 'tool')?.content).toMatch(
        /^invalid: /,
      );
      expect((await readPersonas(seeded.aiId)).persona).toBe(secretPersona);

      const logged = loggedText(logger.calls);
      const everything = `${logged}\n${JSON.stringify(logger.calls)}\n${JSON.stringify(core.sent)}`;
      expect(everything).not.toContain(secretPersona);
      expect(everything).not.toContain(VIRTUAL_KEY);
      expect(everything).not.toContain(MASTER_KEY);
      expect(everything).not.toContain(PROVIDER_KEY);
      expect(logger.calls.some((call) => call.fields['aiId'] === seeded.aiId)).toBe(true);
    });

    it('keeps the persona change when the second call fails and says so', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl } = scriptedFetch([
        toolCallResponse([
          {
            id: 'call-1',
            name: 'update_persona',
            args: { persona: NEW_PERSONA, summary: 'Responde en español' },
          },
        ]),
        jsonResponse({ error: { message: 'over budget' } }, 429),
      ]);
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'answer in Spanish'));
      await waitFor(() => core.sent.length === 1);
      expect(core.sent[0]?.text).toBe(
        `${BUDGET_EXCEEDED_REPLY}\n\n✏️ Persona updated: Responde en español. Say "undo" to revert.`,
      );
      expect(await readPersonas(seeded.aiId)).toEqual({
        persona: NEW_PERSONA,
        previousPersona: OLD_PERSONA,
      });
    });
  });

  describe('memory tools (T-0444)', () => {
    function toolCallResponse(
      calls: Array<{ id: string; name: string; args: unknown }>,
      content: string | null = null,
    ): Response {
      return jsonResponse({
        choices: [
          {
            message: {
              content,
              tool_calls: calls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.args) },
              })),
            },
          },
        ],
      });
    }

    function scriptedFetch(responses: Response[]): { fetchImpl: FetchLike; calls: Call[] } {
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

    function toolMessageOf(
      call: Call,
    ): { role: string; content: string; tool_call_id?: string } | undefined {
      const body = JSON.parse(String(call.init.body)) as {
        messages: Array<{ role: string; content: string; tool_call_id?: string }>;
      };
      return body.messages.find((message) => message.role === 'tool');
    }

    async function factsFor(aiId: string, chatKey: string): Promise<string[]> {
      const rows = await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{ text: string }>`SELECT text FROM ai_memory_facts
            WHERE ai_id = ${aiId} AND chat_key = ${chatKey}`;
        }),
      );
      return rows.map((row) => row.text);
    }

    it('saves a remembered fact in this DM and answers the model `ok`, without logging the text', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const fact = 'The launch is on Friday.';
      const { fetchImpl, calls } = scriptedFetch([
        toolCallResponse([{ id: 'call-1', name: 'remember', args: { text: fact } }]),
        completionResponse('noted'),
      ]);
      const { gateway: started, logger } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'remember the launch'));
      await waitFor(() => core.sent.length === 1);

      expect(await factsFor(seeded.aiId, `dm:${seeded.ownerJid}`)).toEqual([fact]);
      expect(toolMessageOf(calls[1]!)?.content).toBe('ok');
      expect(core.sent[0]?.text).toBe(`noted\n\nRemembered: ${fact}`);
      expect(JSON.stringify(logger.calls)).not.toContain(fact);
    });

    it('adds no remembered line for a duplicate fact', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const fact = 'The launch is on Friday.';
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO ai_memory_facts ${sql.insert({
            id: randomUUID(),
            ai_id: seeded.aiId,
            chat_key: `dm:${seeded.ownerJid}`,
            text: fact,
          })}`;
        }),
      );
      const { fetchImpl, calls } = scriptedFetch([
        toolCallResponse([{ id: 'call-1', name: 'remember', args: { text: fact } }]),
        completionResponse('noted'),
      ]);
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'remember the launch'));
      await waitFor(() => core.sent.length === 1);

      expect(toolMessageOf(calls[1]!)?.content).toBe('already remembered');
      expect(core.sent[0]?.text).toBe('noted');
    });

    it('refuses a secret-looking fact and stores nothing', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = scriptedFetch([
        toolCallResponse([
          { id: 'call-1', name: 'remember', args: { text: 'password: hunter22' } },
        ]),
        completionResponse('noted'),
      ]);
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'save this'));
      await waitFor(() => core.sent.length === 1);

      expect(await factsFor(seeded.aiId, `dm:${seeded.ownerJid}`)).toEqual([]);
      expect(toolMessageOf(calls[1]!)?.content).toBe('refused: looks like a secret');
    });

    it('refuses a sixth remember in one turn after five saved', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const texts = ['fact one', 'fact two', 'fact three', 'fact four', 'fact five', 'fact six'];
      const { fetchImpl, calls } = scriptedFetch([
        toolCallResponse(
          texts.map((text, index) => ({
            id: `call-${index + 1}`,
            name: 'remember',
            args: { text },
          })),
        ),
        completionResponse('noted'),
      ]);
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'remember all this'));
      await waitFor(() => core.sent.length === 1);

      const saved = await factsFor(seeded.aiId, `dm:${seeded.ownerJid}`);
      expect(saved).toHaveLength(5);
      expect(new Set(saved)).toEqual(new Set(texts.slice(0, 5)));
      expect(saved).not.toContain('fact six');
      const body = JSON.parse(String(calls[1]!.init.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      const toolContents = body.messages
        .filter((message) => message.role === 'tool')
        .map((message) => message.content);
      expect(toolContents).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'refused: at most 5 per turn']);
    });

    it('recalls seeded lines from this chat only', async () => {
      const seeded = await seedAi(context);
      const chatKey = `dm:${seeded.ownerJid}`;
      const values = [
        {
          ai_id: seeded.aiId,
          chat_key: chatKey,
          seq: 1,
          message_id: 'mine-1',
          at: new Date('2026-10-05T00:00:00Z'),
          sender: 'Owner',
          text: 'the launch is friday',
        },
        {
          ai_id: seeded.aiId,
          chat_key: chatKey,
          seq: 2,
          message_id: 'mine-2',
          at: new Date('2026-10-05T00:00:01Z'),
          sender: 'Gateway AI',
          text: 'noted, the launch is friday',
        },
        {
          ai_id: seeded.aiId,
          chat_key: 'dm:someone-else',
          seq: 1,
          message_id: 'theirs-1',
          at: new Date('2026-10-05T00:00:02Z'),
          sender: 'Someone',
          text: 'the launch is in another chat',
        },
      ];
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO ai_memory_messages ${sql.insert(values)}`;
        }),
      );
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = scriptedFetch([
        toolCallResponse([{ id: 'call-1', name: 'recall', args: { query: 'launch' } }]),
        completionResponse('found it'),
      ]);
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'when is the launch?'));
      await waitFor(() => core.sent.length === 1);

      const content = toolMessageOf(calls[1]!)?.content ?? '';
      expect(content).toContain('#1 2026-10-05 Owner: the launch is friday');
      expect(content).toContain('#2 2026-10-05 Gateway AI: noted, the launch is friday');
      expect(content).not.toContain('another chat');
    });

    it('answers `no matches` when recall finds nothing', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = scriptedFetch([
        toolCallResponse([{ id: 'call-1', name: 'recall', args: { query: 'nothing at all' } }]),
        completionResponse('no idea'),
      ]);
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'do you know?'));
      await waitFor(() => core.sent.length === 1);

      expect(toolMessageOf(calls[1]!)?.content).toBe('no matches');
    });

    it('answers `invalid: unknown block` for an out-of-range memory_zoom block', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = scriptedFetch([
        toolCallResponse([{ id: 'call-1', name: 'memory_zoom', args: { block: '0-15' } }]),
        completionResponse('nothing there'),
      ]);
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'open that block'));
      await waitFor(() => core.sent.length === 1);

      expect(toolMessageOf(calls[1]!)?.content).toBe('invalid: unknown block');
    });
  });

  describe('memory compaction (T-0446)', () => {
    async function seedMirror(aiId: string, chatKey: string, count: number): Promise<void> {
      const values = Array.from({ length: count }, (_, seq) => ({
        ai_id: aiId,
        chat_key: chatKey,
        seq,
        message_id: `${chatKey}-m${seq}`,
        at: new Date(Date.UTC(2026, 0, 1) + seq * 86_400_000),
        sender: 'Bob',
        text: `mirror-${seq}`,
        deleted: false,
      }));
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO ai_memory_messages ${sql.insert(values)}`;
        }),
      );
    }

    it('summarises a pending block after the reply, with the AI model and key', async () => {
      const seeded = await seedAi(context);
      const chatKey = `dm:${seeded.ownerJid}`;
      await seedMirror(seeded.aiId, chatKey, 66);
      const cores: FakeCore[] = [];
      const calls: Call[] = [];
      let core: FakeCore | undefined;
      let sentWhenCompacting = -1;
      const fetchImpl: FetchLike = (url, init) => {
        calls.push({ url, init });
        if (calls.length === 2) {
          sentWhenCompacting = core?.sent.length ?? 0;
        }
        return Promise.resolve(completionResponse('AI says hi'));
      };
      const { gateway: started, logger } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      core = await coreFor(cores, seeded.aiJid);

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'hello'));
      await waitFor(() => calls.length === 2);

      const sent = bodyOf(calls[1]!).messages;
      const prompt = sent[sent.length - 1]?.content ?? '';
      expect(prompt).toContain('Compress chat memory #0-15');
      for (let seq = 0; seq < 16; seq += 1) {
        expect(prompt).toContain(`#${seq} `);
      }
      // The reply went out before the compaction call.
      expect(sentWhenCompacting).toBeGreaterThanOrEqual(1);
      expect(core.sent[0]).toEqual({ to: seeded.ownerJid, kind: 'chat', text: 'AI says hi' });

      const nodes = await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{ lo: number; hi: number; summary: string }>`SELECT lo, hi,
            summary FROM ai_memory_nodes
            WHERE ai_id = ${seeded.aiId} AND chat_key = ${chatKey}`;
        }),
      );
      expect(nodes).toEqual([{ lo: 0, hi: 16, summary: 'AI says hi' }]);

      const logged = logger.calls
        .map((call) => `${call.message}\n${JSON.stringify(call.fields)}`)
        .join('\n');
      expect(logged).not.toContain('AI says hi');
      for (let seq = 0; seq < 66; seq += 1) {
        expect(logged).not.toContain(`mirror-${seq}`);
      }
    });

    it('skips compaction when the daily limit is crossed before the check', async () => {
      const seeded = await seedAi(context);
      const chatKey = `dm:${seeded.ownerJid}`;
      await seedMirror(seeded.aiId, chatKey, 66);
      const cores: FakeCore[] = [];
      const litellm = new FakeLitellm();
      litellm.spendByKey.set('tok-1', 0.5);
      let calls = 0;
      const fetchImpl: FetchLike = () => {
        calls += 1;
        // The reply call resolves, then the spend jumps past the cap before the
        // compactor's own gate reads it.
        if (calls === 1) {
          litellm.spendByKey.set('tok-1', 2);
        }
        return Promise.resolve(completionResponse('AI says hi'));
      };
      const { gateway: started } = harness(cores, fetchImpl, litellm);
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'hello'));
      await waitFor(() => core.sent.length >= 1);
      await tick(500);

      expect(calls).toBe(1);
      const nodes = await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{ lo: number }>`SELECT lo FROM ai_memory_nodes
            WHERE ai_id = ${seeded.aiId} AND chat_key = ${chatKey}`;
        }),
      );
      expect(nodes).toEqual([]);
    });
  });
});
