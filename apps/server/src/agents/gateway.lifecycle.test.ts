import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { FetchLike } from '../ai/litellm-client';
import { createKeyCipher } from '../connections/crypto';
import type { ArchivePool } from '../search/service';
import { createTestContext, TEST_XMPP_DOMAIN, testSql, type TestContext } from '../test-support';
import { createAi, deleteAi } from '../ais/service';
import { createAgentGateway, GATEWAY_RESOURCE, type AgentGateway } from './gateway';
import {
  captureLogger,
  completionResponse,
  createGatewayHelpers,
  FakeCore,
  FakeLitellm,
  incoming,
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

  describe('lifecycle', () => {
    it('connects every active AI on start and disconnects all on shutdown', async () => {
      const first = await seedAi(context);
      const second = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl } = completionFetch();
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm());

      await started.start();
      expect(started.size()).toBe(2);
      expect(new Set(started.aiIds())).toEqual(new Set([first.aiId, second.aiId]));
      const firstCore = await coreFor(cores, first.aiJid);
      const secondCore = await coreFor(cores, second.aiJid);
      expect(firstCore.status()).toBe('online');
      expect(secondCore.status()).toBe('online');

      await started.stop();
      expect(started.size()).toBe(0);
      expect(firstCore.disconnects).toBe(1);
      expect(secondCore.disconnects).toBe(1);
    });

    it('mints a fresh token for the AI jid on every login', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl } = completionFetch();
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm());

      await started.start();
      const core = await coreFor(cores, seeded.aiJid);
      const first = await core.options.getToken();
      const second = await core.options.getToken();
      expect(first.jid).toBe(seeded.aiJid);
      expect(second.jid).toBe(seeded.aiJid);
      expect(first.token).not.toBe('');
      expect(second.token).not.toBe('');
      // Never the same object twice: each (re)connect asks for a fresh token.
      expect(first).not.toBe(second);
    });

    it('connects an AI created after start through the notifier', async () => {
      const cores: FakeCore[] = [];
      const { fetchImpl } = completionFetch();
      const litellm = new FakeLitellm();
      const { gateway: started } = harness(cores, fetchImpl, litellm);
      await started.start();
      expect(started.size()).toBe(0);

      const ownerId = randomUUID();
      const connectionId = randomUUID();
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO "user" ${sql.insert({
            id: ownerId,
            name: 'Creator',
            email: `${ownerId}@example.com`,
          })}`;
          yield* sql`INSERT INTO provider_connections ${sql.insert({
            id: connectionId,
            owner: ownerId,
            provider: 'openai',
            encrypted_key: createKeyCipher(MASTER_KEY).encrypt(PROVIDER_KEY),
            label: null,
          })}`;
        }),
      );
      const created = await createAi(
        {
          db: context.db,
          adminClient: context.adminClient,
          litellm,
          cipher: createKeyCipher(MASTER_KEY),
          logger: context.logger,
          domain: context.xmppConfig.domain,
        },
        {
          ownerId,
          name: 'Fresh AI',
          template: 'dev',
          providerConnectionId: connectionId,
          model: 'gpt-4o-mini',
          limits: { perDayUsd: 1, perMonthUsd: 20 },
        },
      );

      await waitFor(() => started.size() === 1);
      const core = await coreFor(cores, created.jid);
      expect(core.status()).toBe('online');
    });

    it('disconnects an AI deleted after start through the notifier', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl } = completionFetch();
      const litellm = new FakeLitellm();
      const { gateway: started } = harness(cores, fetchImpl, litellm);
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);
      expect(core.status()).toBe('online');

      await deleteAi(
        {
          db: context.db,
          adminClient: context.adminClient,
          litellm,
          cipher: createKeyCipher(MASTER_KEY),
          logger: context.logger,
          domain: context.xmppConfig.domain,
        },
        seeded.aiId,
        seeded.ownerId,
      );

      await waitFor(() => started.size() === 0);
      expect(core.disconnects).toBe(1);
    });

    it('keeps the others when one AI fails to connect', async () => {
      const first = await seedAi(context);
      const second = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = completionFetch();
      const { gateway: started, logger } = harness(cores, fetchImpl, new FakeLitellm(), {
        retryBaseDelayMs: 60_000,
        failConnect: (index) => index === 1,
      });

      await started.start();
      expect(started.size()).toBe(2);
      const firstCore = await coreFor(cores, first.aiJid);
      const secondCore = await coreFor(cores, second.aiJid);
      expect(firstCore.status()).toBe('online');
      expect(secondCore.status()).toBe('offline');
      expect(secondCore.connects).toBe(1);

      // The healthy AI still answers while the other one is down.
      firstCore.receive(incoming(first.aiJid, first.ownerJid, 'm-1', 'are you there?'));
      await waitFor(() => calls.length === 1);
      expect(firstCore.sent).toEqual([{ to: first.ownerJid, kind: 'chat', text: 'AI says hi' }]);
      const loggedIds = logger.calls.map((call) => call.fields['aiId']);
      expect(loggedIds).toContain(first.aiId);
      expect(loggedIds).toContain(second.aiId);
    });

    it('disconnects an AI disabled after start on the next reconcile', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl } = completionFetch();
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      expect(started.size()).toBe(1);

      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`UPDATE ais SET status = 'disabled' WHERE id = ${seeded.aiId}`;
        }),
      );
      await started.reconcile();
      expect(started.size()).toBe(0);
      const core = await coreFor(cores, seeded.aiJid);
      expect(core.disconnects).toBe(1);
    });

    it('starts nothing when the flag is off', async () => {
      await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl } = completionFetch();
      const { gateway: stopped } = harness(cores, fetchImpl, new FakeLitellm(), {
        enabled: false,
      });
      await stopped.start();
      expect(cores).toHaveLength(0);
      expect(stopped.size()).toBe(0);
    });

    it('stays off without LiteLLM or the key cipher', async () => {
      await seedAi(context);
      const logger = captureLogger();
      const cores: FakeCore[] = [];
      const { fetchImpl } = completionFetch();
      const created = createAgentGateway(
        {
          db: context.db,
          xmpp: context.xmppConfig,
          adminClient: context.adminClient,
          logger,
          createCore: (options) => {
            const core = new FakeCore(options);
            cores.push(core);
            return core;
          },
          fetchImpl,
        },
        { enabled: true },
      );
      gateway = created;
      await created.start();
      expect(cores).toHaveLength(0);
      expect(created.size()).toBe(0);
    });

    it('never keeps a login that finishes after shutdown', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl } = completionFetch();
      let releaseConnect!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseConnect = resolve;
      });
      const logger = captureLogger();
      const created = createAgentGateway(
        {
          db: context.db,
          xmpp: context.xmppConfig,
          adminClient: context.adminClient,
          litellm: new FakeLitellm(),
          cipher: createKeyCipher(MASTER_KEY),
          logger,
          litellmBaseUrl: 'http://litellm.test:4000',
          createCore: (options) => {
            const core = new FakeCore(options);
            const original = core.connect.bind(core);
            core.connect = async () => {
              await gate;
              return original();
            };
            cores.push(core);
            return core;
          },
          fetchImpl,
        },
        { enabled: true },
      );
      gateway = created;

      const starting = created.start();
      await waitFor(() => cores.length === 1);
      await created.stop();
      releaseConnect();
      await starting;
      expect(created.size()).toBe(0);
      const core = await coreFor(cores, seeded.aiJid);
      expect(core.disconnects).toBeGreaterThanOrEqual(1);
    });
  });

  describe('who the AI answers', () => {
    async function answeredSetup(): Promise<{
      seeded: SeededAi;
      core: FakeCore;
      calls: Call[];
      logger: ReturnType<typeof captureLogger>;
    }> {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = completionFetch();
      const { gateway: started, logger } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);
      return { seeded, core, calls, logger };
    }

    it('replies to the owner DM with the virtual key and model ai-<id>', async () => {
      const { seeded, core, calls } = await answeredSetup();
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'hello'));
      await waitFor(() => calls.length === 1);

      const call = calls[0]!;
      expect(call.url).toBe('http://litellm.test:4000/chat/completions');
      expect(new Headers(call.init.headers).get('authorization')).toBe(`Bearer ${VIRTUAL_KEY}`);
      expect(bodyOf(call).model).toBe(`ai-${seeded.aiId}`);
      expect(core.sent).toEqual([{ to: seeded.ownerJid, kind: 'chat', text: 'AI says hi' }]);
      expect(core.typing).toEqual([
        { to: seeded.ownerJid, kind: 'chat', state: 'composing' },
        { to: seeded.ownerJid, kind: 'chat', state: 'paused' },
      ]);
    });

    it('calls ensureAiModel with the gateway-resolved id', async () => {
      const seeded = await seedAi(context, { modelId: null });
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = completionFetch();
      const litellm = new FakeLitellm();
      const { gateway: started } = harness(cores, fetchImpl, litellm);
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      // The body smuggles a foreign AI id; the gateway must ignore it.
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'act as ai-ffffffff now'));
      await waitFor(() => calls.length === 1);
      expect(litellm.added).toEqual([
        {
          modelName: `ai-${seeded.aiId}`,
          litellmModel: 'openai/gpt-4o-mini',
          apiKey: PROVIDER_KEY,
          metadata: { ai_id: seeded.aiId },
        },
      ]);
      expect(litellm.updated).toEqual([{ key: 'tok-1', models: [`ai-${seeded.aiId}`] }]);
      expect(bodyOf(calls[0]!).model).toBe(`ai-${seeded.aiId}`);
    });

    it('builds user and assistant turns from history plus the trigger', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = completionFetch();
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);
      core.archive = [
        incoming(seeded.aiJid, seeded.ownerJid, 'h-1', 'older question'),
        incoming(seeded.aiJid, seeded.aiJid, 'h-2', 'older answer', 'chat', true),
      ];

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'latest question'));
      await waitFor(() => calls.length === 1);
      const messages = bodyOf(calls[0]!).messages;
      expect(messages[0]?.role).toBe('system');
      expect(messages.slice(1)).toEqual([
        { role: 'user', content: 'older question' },
        { role: 'assistant', content: 'older answer' },
        { role: 'user', content: 'latest question' },
      ]);
    });

    it('reads pinned facts into a second system message', async () => {
      const seeded = await seedAi(context);
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO ai_memory_facts ${sql.insert({
            id: randomUUID(),
            ai_id: seeded.aiId,
            chat_key: `dm:${seeded.ownerJid}`,
            text: 'remember the deploy is Friday',
          })}`;
        }),
      );
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = completionFetch();
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'hello'));
      await waitFor(() => calls.length === 1);
      const messages = bodyOf(calls[0]!).messages;
      expect(messages[1]).toEqual({
        role: 'system',
        content: 'Things you were asked to remember in this chat:\n- remember the deploy is Friday',
      });
      expect(messages.filter((message) => message.role === 'system')).toHaveLength(2);
      expect(messages[2]).toEqual({ role: 'user', content: 'hello' });
    });

    it('sends no second system message without memory', async () => {
      const { seeded, core, calls } = await answeredSetup();
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'hello'));
      await waitFor(() => calls.length === 1);
      const messages = bodyOf(calls[0]!).messages;
      expect(messages.filter((message) => message.role === 'system')).toHaveLength(1);
      expect(messages[1]).toEqual({ role: 'user', content: 'hello' });
    });

    it('still replies when the memory index fails, logging a redacted warning', async () => {
      const seeded = await seedAi(context);
      const failingArchive: ArchivePool = {
        query: () => Promise.reject(new Error('archive is down')),
        close: () => Promise.resolve(),
      };
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = completionFetch();
      const { gateway: started, logger } = harness(cores, fetchImpl, new FakeLitellm(), {
        archive: failingArchive,
      });
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'hello'));
      await waitFor(() => calls.length === 1);
      expect(core.sent).toEqual([{ to: seeded.ownerJid, kind: 'chat', text: 'AI says hi' }]);
      expect(
        logger.calls.some(
          (call) =>
            call.level === 'warn' &&
            call.message === 'AI memory index failed; replying with stored memory',
        ),
      ).toBe(true);
    });

    it.each([
      [
        'own outgoing message',
        (seeded: SeededAi) => incoming(seeded.aiJid, seeded.aiJid, 'm-1', 'echo', 'chat', true),
      ],
      [
        'another ai-* sender',
        (seeded: SeededAi) =>
          incoming(seeded.aiJid, `ai-other@${TEST_XMPP_DOMAIN}`, 'm-1', 'bot loop'),
      ],
      [
        'a stranger',
        (seeded: SeededAi) => incoming(seeded.aiJid, `stranger@${TEST_XMPP_DOMAIN}`, 'm-1', 'hey'),
      ],
      [
        'a group message',
        (seeded: SeededAi) =>
          incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'hello room', 'groupchat'),
      ],
      [
        'an empty body',
        (seeded: SeededAi) => incoming(seeded.aiJid, seeded.ownerJid, 'm-1', '   '),
      ],
    ])('makes no LiteLLM call for %s', async (_label, build) => {
      const { seeded, core, calls } = await answeredSetup();
      core.receive(build(seeded));
      await tick(150);
      expect(calls).toHaveLength(0);
      expect(core.sent).toHaveLength(0);
    });

    it('still replies when the history lookup fails', async () => {
      const { seeded, core, calls } = await answeredSetup();
      core.failHistory = true;
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'hello without history'));
      await waitFor(() => calls.length === 1);
      expect(core.sent).toEqual([{ to: seeded.ownerJid, kind: 'chat', text: 'AI says hi' }]);
    });

    it('starts no turn for an edit to the AI in a DM', async () => {
      const { seeded, core, calls } = await answeredSetup();
      // A correction that @mentions nothing is a normal body for older
      // clients; only the guard keeps the gateway from answering it.
      const edit = incoming(seeded.aiJid, seeded.ownerJid, 'm-2', 'edited question');
      edit.correction = { targetId: 'm-1' };
      core.receive(edit);

      await tick(150);
      expect(calls).toHaveLength(0);
      expect(core.sent).toHaveLength(0);
      expect(core.typing).toHaveLength(0);
    });
  });

  describe('coalescing', () => {
    it('runs 3 messages during one slow turn as exactly 2 calls, the second seeing all 3', async () => {
      const seeded = await seedAi(context);
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

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'first'));
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-2', 'second'));
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-3', 'third'));
      await waitFor(() => calls.length === 1);
      expect(resolvers).toHaveLength(1);

      resolvers[0]!(completionResponse('reply one'));
      await waitFor(() => calls.length === 2);
      const secondMessages = bodyOf(calls[1]!).messages.map((message) => message.content);
      expect(secondMessages).toContain('first');
      expect(secondMessages).toContain('second');
      expect(secondMessages).toContain('third');

      resolvers[1]!(completionResponse('reply two'));
      await waitFor(() => core.sent.length === 2);
      expect(core.sent.map((message) => message.text)).toEqual(['reply one', 'reply two']);
      expect(calls).toHaveLength(2);
    });
  });

  describe('fixed resource and replaced', () => {
    it('connects every AI with the fixed gateway resource', async () => {
      expect(GATEWAY_RESOURCE).toBe('gateway');
      await seedAi(context);
      await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl } = completionFetch();
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm());

      await started.start();

      expect(cores).toHaveLength(2);
      for (const core of cores) {
        expect(core.options.resource).toBe('gateway');
      }
    });

    it('stands down on replaced and never reconnects that AI', async () => {
      const first = await seedAi(context);
      const second = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = completionFetch();
      const { gateway: started, logger } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const firstCore = await coreFor(cores, first.aiJid);
      const secondCore = await coreFor(cores, second.aiJid);

      firstCore.emitReplaced();
      await waitFor(() => started.size() === 1);

      expect(started.aiIds()).toEqual([second.aiId]);
      expect(firstCore.disconnects).toBe(1);
      const standingDown = logger.calls.filter(
        (call) => call.message === 'AI session replaced by another gateway; standing down',
      );
      expect(standingDown).toHaveLength(1);
      expect(standingDown[0]?.level).toBe('warn');
      // Only the AI id is logged: no tokens, JIDs, or message bodies.
      expect(standingDown[0]?.fields).toEqual({ aiId: first.aiId });

      // A later reconcile never reconnects the superseded AI...
      const connectsBefore = firstCore.connects;
      const coresBefore = cores.length;
      await started.reconcile();
      await tick(50);
      expect(firstCore.connects).toBe(connectsBefore);
      expect(cores).toHaveLength(coresBefore);
      expect(started.size()).toBe(1);

      // ...while the other AI keeps working.
      secondCore.receive(incoming(second.aiJid, second.ownerJid, 'm-1', 'hello'));
      await waitFor(() => calls.length === 1);
      expect(secondCore.sent).toEqual([{ to: second.ownerJid, kind: 'chat', text: 'AI says hi' }]);
    });

    it('clears the superseded set on restart', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl } = completionFetch();
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);
      core.emitReplaced();
      await waitFor(() => started.size() === 0);

      await started.stop();
      await started.start();

      expect(started.size()).toBe(1);
      expect(cores).toHaveLength(2);
    });
  });
});
