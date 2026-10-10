import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { FetchLike } from '../ai/litellm-client';
import { createKeyCipher } from '../connections/crypto';
import { createTestContext, TEST_XMPP_DOMAIN, testSql, type TestContext } from '../test-support';
import { createAi, deleteAi, onAiLifecycle, type AiServiceDeps } from '../ais/service';
import { type AgentGateway } from './gateway';
import {
  BUDGET_EXCEEDED_REPLY,
  PROVIDER_KEY_REJECTED_REPLY,
  TRANSIENT_FAILURE_REPLY,
} from './reply';
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

  const { harness, completionFetch, coreFor } = createGatewayHelpers({
    getContext: () => context,
    setGateway: (created) => {
      gateway = created;
    },
  });

  describe('read markers', () => {
    it('sends one displayed marker per turn, for the last owner message', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl } = completionFetch();
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'first'));
      await waitFor(() => core.sent.length === 1);
      expect(core.displayed).toEqual([
        { chatJid: seeded.ownerJid, kind: 'chat', messageId: 'm-1' },
      ]);

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-2', 'second'));
      await waitFor(() => core.sent.length === 2);
      expect(core.displayed).toEqual([
        { chatJid: seeded.ownerJid, kind: 'chat', messageId: 'm-1' },
        { chatJid: seeded.ownerJid, kind: 'chat', messageId: 'm-2' },
      ]);
    });

    it('marks the last owner message of a coalesced batch', async () => {
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
      await waitFor(() => calls.length === 1);
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-2', 'second'));
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-3', 'third'));
      resolvers[0]!(completionResponse('reply one'));
      await waitFor(() => calls.length === 2);
      resolvers[1]!(completionResponse('reply two'));
      await waitFor(() => core.sent.length === 2);

      expect(core.displayed).toEqual([
        { chatJid: seeded.ownerJid, kind: 'chat', messageId: 'm-1' },
        { chatJid: seeded.ownerJid, kind: 'chat', messageId: 'm-3' },
      ]);
    });

    it('marks nothing for strangers and other AIs', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = completionFetch();
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      core.receive(incoming(seeded.aiJid, `stranger@${TEST_XMPP_DOMAIN}`, 'm-9', 'hey'));
      core.receive(incoming(seeded.aiJid, `ai-other@${TEST_XMPP_DOMAIN}`, 'm-10', 'bot loop'));
      await tick(150);

      expect(calls).toHaveLength(0);
      expect(core.sent).toHaveLength(0);
      expect(core.displayed).toHaveLength(0);
    });

    it('sends the marker before the reply', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl } = completionFetch();
      const { gateway: started } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);
      const order: string[] = [];
      const mark = core.markDisplayed.bind(core);
      core.markDisplayed = (chatJid, kind, messageId) => {
        order.push(`mark:${messageId}`);
        mark(chatJid, kind, messageId);
      };
      const send = core.sendMessage.bind(core);
      core.sendMessage = async (to, kind, text) => {
        order.push(`send:${text}`);
        return send(to, kind, text);
      };

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'hello'));
      await waitFor(() => core.sent.length === 1);

      expect(order).toEqual(['mark:m-1', 'send:AI says hi']);
    });
  });

  describe('pump resilience', () => {
    it('logs a failed send redacted and still answers the next message', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl } = completionFetch('back online');
      const { gateway: started, logger } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      // The model answers but the DM send throws: the error is logged
      // redacted with the AI id, and the pump must not get stuck.
      const loggedBefore = logger.calls.length;
      core.failSend = true;
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'are you there?'));
      await waitFor(() => logger.calls.length > loggedBefore);
      const logged = loggedText(logger.calls);
      expect(logged).not.toContain(VIRTUAL_KEY);
      expect(logged).not.toContain(MASTER_KEY);
      expect(logged).not.toContain(PROVIDER_KEY);
      expect(logger.calls.some((call) => call.fields['aiId'] === seeded.aiId)).toBe(true);
      expect(core.sent).toHaveLength(0);

      core.failSend = false;
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-2', 'are you there now?'));
      await waitFor(() => core.sent.length === 1);
      expect(core.sent).toEqual([{ to: seeded.ownerJid, kind: 'chat', text: 'back online' }]);
    });
  });

  describe('honest failures', () => {
    async function failedSetup(
      fetchImpl: FetchLike,
    ): Promise<{ seeded: SeededAi; core: FakeCore; logger: ReturnType<typeof captureLogger> }> {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { gateway: started, logger } = harness(cores, fetchImpl, new FakeLitellm());
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);
      return { seeded, core, logger };
    }

    function echoFetch(status: number, key: string): FetchLike {
      return () =>
        Promise.resolve(jsonResponse({ error: { message: `provider echoed ${key}` } }, status));
    }

    it('posts the spending-limit text on 429 and leaks no secret', async () => {
      const { seeded, core, logger } = await failedSetup(echoFetch(429, VIRTUAL_KEY));
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'hello'));
      await waitFor(() => core.sent.length === 1);
      expect(core.sent[0]?.text).toBe(BUDGET_EXCEEDED_REPLY);
      const logged = loggedText(logger.calls);
      expect(logged).not.toContain(VIRTUAL_KEY);
      expect(logged).not.toContain(MASTER_KEY);
      expect(logged).not.toContain(PROVIDER_KEY);
      expect(JSON.stringify(core.sent)).not.toContain(VIRTUAL_KEY);
    });

    it('posts the key-rejected text on 401', async () => {
      const { seeded, core } = await failedSetup(echoFetch(401, VIRTUAL_KEY));
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'hello'));
      await waitFor(() => core.sent.length === 1);
      expect(core.sent[0]?.text).toBe(PROVIDER_KEY_REJECTED_REPLY);
    });

    it('posts the transient text on 5xx and on network errors', async () => {
      for (const fetchImpl of [
        echoFetch(500, VIRTUAL_KEY),
        (() => Promise.reject(new Error(`socket failed for ${VIRTUAL_KEY}`))) as FetchLike,
      ]) {
        const { seeded, core } = await failedSetup(fetchImpl);
        core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'hello'));
        await waitFor(() => core.sent.length === 1);
        expect(core.sent[0]?.text).toBe(TRANSIENT_FAILURE_REPLY);
      }
    });
  });

  describe('daily spending limit', () => {
    const LIMIT_NOTICE =
      "I've reached today's spending limit ($1.00). I'll be back after 00:00 UTC.";

    async function limitedSetup(): Promise<{
      seeded: SeededAi;
      core: FakeCore;
      calls: Call[];
      litellm: FakeLitellm;
      setNow: (iso: string) => void;
    }> {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = completionFetch();
      const litellm = new FakeLitellm();
      litellm.spendByKey.set('tok-1', 0.5);
      let current = new Date('2026-09-28T12:00:00Z');
      const { gateway: started } = harness(cores, fetchImpl, litellm, { now: () => current });
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);
      return {
        seeded,
        core,
        calls,
        litellm,
        setNow: (iso: string) => {
          current = new Date(iso);
        },
      };
    }

    it('runs a normal turn under the limit', async () => {
      const { seeded, core, calls } = await limitedSetup();
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'hello'));
      await waitFor(() => calls.length === 1);
      expect(core.sent).toEqual([{ to: seeded.ownerJid, kind: 'chat', text: 'AI says hi' }]);
    });

    it('fails open when the spend lookup fails', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = completionFetch();
      const litellm = new FakeLitellm();
      litellm.failKeyInfo = true;
      const { gateway: started } = harness(cores, fetchImpl, litellm);
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'hello'));
      await waitFor(() => calls.length === 1);
      expect(core.sent).toEqual([{ to: seeded.ownerJid, kind: 'chat', text: 'AI says hi' }]);
    });

    it('sends one notice per DM per day, then stays silent but keeps marking read', async () => {
      const { seeded, core, calls, litellm, setNow } = await limitedSetup();

      // The first turn records the 0.5 baseline and replies normally.
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'hello'));
      await waitFor(() => calls.length === 1);
      expect(core.sent).toEqual([{ to: seeded.ownerJid, kind: 'chat', text: 'AI says hi' }]);

      // Spend climbs past the $1/day cap: the notice goes out, no model call.
      litellm.spendByKey.set('tok-1', 2);
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-2', 'are you there?'));
      await waitFor(() => core.sent.length === 2);
      expect(core.sent[1]).toEqual({ to: seeded.ownerJid, kind: 'chat', text: LIMIT_NOTICE });
      expect(calls).toHaveLength(1);

      // A third message the same day: no reply and no second notice...
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-3', 'still there?'));
      await tick(200);
      expect(core.sent).toHaveLength(2);
      expect(calls).toHaveLength(1);

      // ...but the owner's messages still get their read markers.
      expect(core.displayed).toEqual([
        { chatJid: seeded.ownerJid, kind: 'chat', messageId: 'm-1' },
        { chatJid: seeded.ownerJid, kind: 'chat', messageId: 'm-2' },
        { chatJid: seeded.ownerJid, kind: 'chat', messageId: 'm-3' },
      ]);

      // The next UTC day starts a fresh baseline, so the AI answers again and
      // then notifies once more when the new day's spend crosses the cap.
      setNow('2026-09-29T00:30:00Z');
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-4', 'morning'));
      await waitFor(() => calls.length === 2);
      expect(core.sent).toHaveLength(3);

      litellm.spendByKey.set('tok-1', 3.5);
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-5', 'again?'));
      await waitFor(() => core.sent.length === 4);
      expect(core.sent[3]).toEqual({ to: seeded.ownerJid, kind: 'chat', text: LIMIT_NOTICE });
      expect(calls).toHaveLength(2);
    });
  });

  describe('budget warnings at 80%', () => {
    const DAILY_WARNING =
      "Heads up: I've used $0.80 of my $1.00 daily limit. I'll pause for the day when it runs out.";

    async function warningSetup(): Promise<{
      seeded: SeededAi;
      core: FakeCore;
      calls: Call[];
      litellm: FakeLitellm;
      logger: ReturnType<typeof captureLogger>;
      setNow: (iso: string) => void;
    }> {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = completionFetch();
      const litellm = new FakeLitellm();
      litellm.spendByKey.set('tok-1', 0.5);
      let current = new Date('2026-09-28T12:00:00Z');
      const { gateway: started, logger } = harness(cores, fetchImpl, litellm, {
        now: () => current,
      });
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);
      return {
        seeded,
        core,
        calls,
        litellm,
        logger,
        setNow: (iso: string) => {
          current = new Date(iso);
        },
      };
    }

    it('sends the reply first, then one daily warning, and no second warning the same day', async () => {
      const { seeded, core, calls, litellm, logger } = await warningSetup();

      // First turn records the 0.5 baseline and replies with no warning.
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'hello'));
      await waitFor(() => calls.length === 1);
      await waitFor(() => core.sent.length === 1);
      expect(core.sent[0]).toEqual({ to: seeded.ownerJid, kind: 'chat', text: 'AI says hi' });

      // Spend climbs to exactly 80% of the $1/day cap: reply, then warning.
      litellm.spendByKey.set('tok-1', 1.3);
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-2', 'are you there?'));
      await waitFor(() => core.sent.length === 3);
      expect(calls).toHaveLength(2);
      expect(core.sent[1]).toEqual({ to: seeded.ownerJid, kind: 'chat', text: 'AI says hi' });
      expect(core.sent[2]).toEqual({ to: seeded.ownerJid, kind: 'chat', text: DAILY_WARNING });

      // A third message the same day gets a reply but no second warning.
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-3', 'still there?'));
      await waitFor(() => calls.length === 3);
      await waitFor(() => core.sent.length === 4);
      expect(core.sent[3]).toEqual({ to: seeded.ownerJid, kind: 'chat', text: 'AI says hi' });
      expect(core.sent.filter((message) => message.text === DAILY_WARNING)).toHaveLength(1);

      // Nothing new logs amounts, keys or message text.
      const logged = loggedText(logger.calls);
      expect(logged).not.toContain('$0.80');
      expect(logged).not.toContain('$1.00');
      expect(logged).not.toContain(VIRTUAL_KEY);
      expect(logged).not.toContain(MASTER_KEY);
      expect(logged).not.toContain('are you there?');
    });

    it('warns again on the next UTC day', async () => {
      const { seeded, core, calls, litellm, setNow } = await warningSetup();

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'hello'));
      await waitFor(() => calls.length === 1);
      litellm.spendByKey.set('tok-1', 1.3);
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-2', 'again?'));
      await waitFor(() => core.sent.length === 3);
      expect(core.sent[2]?.text).toBe(DAILY_WARNING);

      // The next UTC day starts a fresh baseline: the first turn replies
      // without a warning...
      setNow('2026-09-29T00:30:00Z');
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-3', 'morning'));
      await waitFor(() => calls.length === 3);
      await waitFor(() => core.sent.length === 4);
      expect(core.sent[3]).toEqual({ to: seeded.ownerJid, kind: 'chat', text: 'AI says hi' });

      // ...and the turn that crosses 80% of the new day warns again.
      litellm.spendByKey.set('tok-1', 2.2);
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-4', 'later'));
      await waitFor(() => core.sent.length === 6);
      expect(core.sent[4]).toEqual({ to: seeded.ownerJid, kind: 'chat', text: 'AI says hi' });
      expect(core.sent[5]?.text).toContain('of my $1.00 daily limit');
    });

    it('sends both warnings once each when daily and monthly cross together', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = completionFetch();
      const litellm = new FakeLitellm();
      // Baseline just below the monthly 80% line ($16 of $20).
      litellm.spendByKey.set('tok-1', 15.5);
      const { gateway: started } = harness(cores, fetchImpl, litellm);
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'hello'));
      await waitFor(() => calls.length === 1);
      await waitFor(() => core.sent.length === 1);

      // Today $0.90 of $1.00 and window $16.40 of $20.00: both cross 80%.
      litellm.spendByKey.set('tok-1', 16.4);
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-2', 'again?'));
      await waitFor(() => core.sent.length === 4);
      expect(calls).toHaveLength(2);
      expect(core.sent[1]).toEqual({ to: seeded.ownerJid, kind: 'chat', text: 'AI says hi' });
      expect(core.sent[2]?.text).toContain('daily limit');
      expect(core.sent[3]?.text).toContain('for this period');
      expect(core.sent[2]?.text).not.toBe(core.sent[3]?.text);

      // Next turn: reply only, each warning was once.
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-3', 'once more'));
      await waitFor(() => calls.length === 3);
      await waitFor(() => core.sent.length === 5);
      expect(core.sent[4]).toEqual({ to: seeded.ownerJid, kind: 'chat', text: 'AI says hi' });
    });

    it('sends the existing notice and no warning at 100%', async () => {
      const { seeded, core, calls, litellm } = await warningSetup();

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'hello'));
      await waitFor(() => calls.length === 1);

      litellm.spendByKey.set('tok-1', 2);
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-2', 'are you there?'));
      await waitFor(() => core.sent.length === 2);
      expect(core.sent[1]?.text).toContain("I've reached today's spending limit");
      expect(core.sent.some((message) => message.text.startsWith('Heads up'))).toBe(false);
      expect(calls).toHaveLength(1);
    });

    it('sends no warning when usage is unavailable', async () => {
      const seeded = await seedAi(context);
      const cores: FakeCore[] = [];
      const { fetchImpl, calls } = completionFetch();
      const litellm = new FakeLitellm();
      litellm.failKeyInfo = true;
      const { gateway: started } = harness(cores, fetchImpl, litellm);
      await started.start();
      const core = await coreFor(cores, seeded.aiJid);

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'hello'));
      await waitFor(() => calls.length === 1);
      await waitFor(() => core.sent.length === 1);
      expect(core.sent).toEqual([{ to: seeded.ownerJid, kind: 'chat', text: 'AI says hi' }]);
    });

    it('a failing warning send never breaks the turn or the next one', async () => {
      const { seeded, core, calls, litellm } = await warningSetup();

      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-1', 'hello'));
      await waitFor(() => calls.length === 1);
      await waitFor(() => core.sent.length === 1);

      litellm.spendByKey.set('tok-1', 1.3);
      const send = core.sendMessage.bind(core);
      let failWarnings = true;
      core.sendMessage = (to, kind, text, opts) => {
        if (failWarnings && text.startsWith('Heads up')) {
          return Promise.reject(new Error('xmpp send is down'));
        }
        return send(to, kind, text, opts);
      };
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-2', 'again?'));
      await waitFor(() => calls.length === 2);
      await waitFor(() => core.sent.length === 2);
      // The reply went out; the warning failed quietly.
      expect(core.sent[1]).toEqual({ to: seeded.ownerJid, kind: 'chat', text: 'AI says hi' });

      // The next turn retries the warning and delivers it after the reply.
      failWarnings = false;
      core.receive(incoming(seeded.aiJid, seeded.ownerJid, 'm-3', 'once more'));
      await waitFor(() => calls.length === 3);
      await waitFor(() => core.sent.length === 4);
      expect(core.sent[2]).toEqual({ to: seeded.ownerJid, kind: 'chat', text: 'AI says hi' });
      expect(core.sent[3]).toEqual({ to: seeded.ownerJid, kind: 'chat', text: DAILY_WARNING });
    });
  });

  describe('service additions', () => {
    it('create and delete emit lifecycle events the gateway observes', async () => {
      const seen: Array<{ type: string; aiId: string }> = [];
      const unsubscribe = onAiLifecycle((event) => {
        seen.push(event);
      });
      try {
        const ownerId = randomUUID();
        const connectionId = randomUUID();
        await testSql(context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`INSERT INTO "user" ${sql.insert({
              id: ownerId,
              name: 'Emitter',
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
        const litellm = new FakeLitellm();
        const serviceDeps: AiServiceDeps = {
          db: context.db,
          adminClient: context.adminClient,
          litellm,
          cipher: createKeyCipher(MASTER_KEY),
          logger: context.logger,
          domain: context.xmppConfig.domain,
        };
        const created = await createAi(serviceDeps, {
          ownerId,
          name: 'Emitter AI',
          template: 'dev',
          providerConnectionId: connectionId,
          model: 'gpt-4o-mini',
          limits: { perDayUsd: 1, perMonthUsd: 20 },
        });
        await deleteAi(serviceDeps, created.id, ownerId);
        expect(seen).toEqual([
          { type: 'created', aiId: created.id },
          { type: 'deleted', aiId: created.id },
        ]);
      } finally {
        unsubscribe();
      }
    });
  });
});
