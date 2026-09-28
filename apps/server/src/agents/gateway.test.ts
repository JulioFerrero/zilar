import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type {
  ChatKind,
  ChatMessage,
  ConnectionStatus,
  XmppCore,
  XmppCoreOptions,
} from '@galena/xmpp-core';
import type {
  AddModelInput,
  FetchLike,
  GenerateVirtualKeyInput,
  LitellmAdminClient,
  ModelListing,
  UpdateVirtualKeyInput,
  VirtualKey,
  VirtualKeyInfo,
} from '../ai/litellm-client';
import { createKeyCipher } from '../connections/crypto';
import { aiLimits, ais, llmVirtualKeys, providerConnections, user } from '../db/schema';
import { createTestContext, TEST_XMPP_DOMAIN, type TestContext } from '../test-support';
import { localpartFor } from '../xmpp/provisioning';
import { aiLocalpart, createAi, deleteAi, onAiLifecycle, type AiServiceDeps } from '../ais/service';
import { createAgentGateway, type AgentGateway, type AgentGatewayDeps } from './gateway';
import {
  BUDGET_EXCEEDED_REPLY,
  PROVIDER_KEY_REJECTED_REPLY,
  TRANSIENT_FAILURE_REPLY,
} from './reply';

const MASTER_KEY = 'test-master-key-0000000000000000000000';
const PROVIDER_KEY = 'sk-provider-key-do-not-leak';
const VIRTUAL_KEY = 'sk-virtual-gateway-key-do-not-leak';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function completionResponse(content: string): Response {
  return jsonResponse({ choices: [{ message: { content } }] });
}

class FakeCore implements XmppCore {
  readonly options: XmppCoreOptions;
  connects = 0;
  disconnects = 0;
  failConnect = false;
  failSend = false;
  failHistory = false;
  sent: Array<{ to: string; kind: ChatKind; text: string }> = [];
  typing: Array<{ to: string; kind: ChatKind; state: 'composing' | 'paused' }> = [];
  /** What MAM returns: every incoming message, archived on receipt. */
  archive: ChatMessage[] = [];
  private statusValue: ConnectionStatus = 'offline';
  private listeners = new Map<string, Set<(payload: unknown) => void>>();

  constructor(options: XmppCoreOptions) {
    this.options = options;
  }

  status(): ConnectionStatus {
    return this.statusValue;
  }

  me(): string | undefined {
    return undefined;
  }

  async connect(): Promise<void> {
    this.connects += 1;
    if (this.failConnect) {
      throw new Error('xmpp is down');
    }
    this.statusValue = 'online';
    this.emit('status', 'online');
  }

  async disconnect(): Promise<void> {
    this.disconnects += 1;
    this.statusValue = 'offline';
    this.emit('status', 'offline');
  }

  joinRoom(): Promise<void> {
    return Promise.resolve();
  }

  leaveRoom(): Promise<void> {
    return Promise.resolve();
  }

  occupants(): [] {
    return [];
  }

  async sendMessage(to: string, kind: ChatKind, text: string): Promise<{ id: string }> {
    if (this.failSend) {
      throw new Error('xmpp send is down');
    }
    this.sent.push({ to, kind, text });
    return { id: `sent-${this.sent.length}` };
  }

  async loadHistory(
    _chatJid: string,
    _kind: ChatKind,
    opts?: { max?: number },
  ): Promise<{ messages: ChatMessage[]; complete: boolean }> {
    if (this.failHistory) {
      throw new Error('mam is down');
    }
    const max = opts?.max ?? 50;
    return { messages: this.archive.slice(-max), complete: true };
  }

  requestUploadSlot(): Promise<{
    putUrl: string;
    getUrl: string;
    headers: Record<string, string>;
  }> {
    throw new Error('uploads are not used by the gateway');
  }

  sendTyping(to: string, kind: ChatKind, state: 'composing' | 'paused'): void {
    this.typing.push({ to, kind, state });
  }

  markDisplayed(): void {
    // Read receipts are out of scope for v0.
  }

  // Contextual typing by the overloaded `XmppCore['on']` gives the arrow
  // union parameter types, so one implementation satisfies every overload.
  on: XmppCore['on'] = (event, listener) => {
    const key: string = event;
    const stored = listener as unknown as (payload: unknown) => void;
    let existing = this.listeners.get(key);
    if (existing === undefined) {
      existing = new Set();
      this.listeners.set(key, existing);
    }
    const set = existing;
    set.add(stored);
    return () => {
      set.delete(stored);
    };
  };

  receive(message: ChatMessage): void {
    this.archive.push(message);
    this.emit('message', message);
  }

  private emit(event: string, payload: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(payload);
    }
  }
}

class FakeLitellm implements LitellmAdminClient {
  readonly added: AddModelInput[] = [];
  readonly updated: UpdateVirtualKeyInput[] = [];
  private modelCounter = 0;
  private keyCounter = 0;

  addModel(input: AddModelInput): Promise<string> {
    this.added.push(input);
    this.modelCounter += 1;
    return Promise.resolve(`model-${this.modelCounter}`);
  }

  deleteModel(): Promise<void> {
    return Promise.resolve();
  }

  listModels(): Promise<ModelListing[]> {
    return Promise.resolve([]);
  }

  generateKey(input: GenerateVirtualKeyInput): Promise<VirtualKey> {
    this.keyCounter += 1;
    return Promise.resolve({
      id: `tok-${this.keyCounter}`,
      key: `sk-virtual-${this.keyCounter}-do-not-leak`,
      keyAlias: input.keyAlias ?? null,
      maxBudget: input.maxBudget ?? null,
      spend: 0,
      models: input.models,
    });
  }

  getKeyInfo(): Promise<VirtualKeyInfo> {
    throw new Error('getKeyInfo is not used by the gateway');
  }

  updateKey(input: UpdateVirtualKeyInput): Promise<VirtualKeyInfo> {
    this.updated.push(input);
    return Promise.resolve({
      keyAlias: null,
      maxBudget: input.maxBudget ?? null,
      spend: 0,
      tpmLimit: null,
      rpmLimit: null,
      blocked: null,
      models: input.models ?? [],
    });
  }

  revokeKey(): Promise<void> {
    return Promise.resolve();
  }
}

function captureLogger() {
  const calls: Array<{ level: string; fields: Record<string, unknown>; message: string }> = [];
  return {
    info: (fields: Record<string, unknown>, message: string) => {
      calls.push({ level: 'info', fields, message });
    },
    warn: (fields: Record<string, unknown>, message: string) => {
      calls.push({ level: 'warn', fields, message });
    },
    calls,
  };
}

// Like the routes tests: JSON.stringify turns an Error into `{}`, so leak
// assertions must read the message and stack off the logged error itself.
function loggedText(calls: Array<{ fields: Record<string, unknown>; message: string }>): string {
  return calls
    .map((call) => {
      const err = call.fields['err'];
      const detail =
        err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : JSON.stringify(err);
      return `${call.message}\n${detail}`;
    })
    .join('\n');
}

interface SeededAi {
  aiId: string;
  ownerId: string;
  ownerJid: string;
  aiJid: string;
}

async function seedAi(
  context: TestContext,
  overrides: { modelId?: string | null; name?: string } = {},
): Promise<SeededAi> {
  const ownerId = randomUUID();
  await context.db
    .insert(user)
    .values({ id: ownerId, name: 'Owner', email: `${ownerId}@example.com` });
  const connectionId = randomUUID();
  await context.db.insert(providerConnections).values({
    id: connectionId,
    owner: ownerId,
    provider: 'openai',
    encryptedKey: createKeyCipher(MASTER_KEY).encrypt(PROVIDER_KEY),
    label: null,
  });
  const aiId = randomUUID();
  const localpart = aiLocalpart(aiId);
  const aiJid = `${localpart}@${TEST_XMPP_DOMAIN}`;
  await context.db.insert(ais).values({
    id: aiId,
    owner: ownerId,
    name: overrides.name ?? 'Gateway AI',
    template: 'dev',
    persona: 'A helpful persona.',
    providerConnectionId: connectionId,
    model: 'gpt-4o-mini',
    localpart,
    jid: aiJid,
    status: 'active',
  });
  await context.db.insert(aiLimits).values({ aiId, perDayUsd: '1.00', perMonthUsd: '20.00' });
  await context.db.insert(llmVirtualKeys).values({
    aiId,
    litellmKeyId: 'tok-1',
    litellmModelId: overrides.modelId === undefined ? 'model-1' : overrides.modelId,
    encryptedKey: createKeyCipher(MASTER_KEY).encrypt(VIRTUAL_KEY),
    budgetUsd: '20.00',
    budgetDuration: '30d',
  });
  return { aiId, ownerId, ownerJid: `${localpartFor(ownerId)}@${TEST_XMPP_DOMAIN}`, aiJid };
}

function incoming(
  aiJid: string,
  fromJid: string,
  id: string,
  body: string | undefined,
  kind: ChatKind = 'chat',
  outgoing = false,
): ChatMessage {
  return {
    id,
    chatJid: aiJid,
    kind,
    fromJid,
    fromResolved: true,
    ...(body === undefined ? {} : { body }),
    timestamp: new Date('2026-09-28T12:00:00Z'),
    outgoing,
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for the condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function tick(ms = 100): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

  function harness(
    cores: FakeCore[],
    fetchImpl: FetchLike,
    litellm: FakeLitellm,
    config: {
      enabled?: boolean;
      retryBaseDelayMs?: number;
      failConnect?: (coreIndex: number) => boolean;
    } = {},
  ): { gateway: AgentGateway; logger: ReturnType<typeof captureLogger> } {
    const logger = captureLogger();
    const failConnect = config.failConnect ?? (() => false);
    const deps: AgentGatewayDeps = {
      db: context.db,
      xmpp: context.xmppConfig,
      adminClient: context.adminClient,
      litellm,
      cipher: createKeyCipher(MASTER_KEY),
      logger,
      litellmBaseUrl: 'http://litellm.test:4000',
      masterKeyForRedaction: MASTER_KEY,
      createCore: (options) => {
        const core = new FakeCore(options);
        if (failConnect(cores.length)) {
          core.failConnect = true;
        }
        cores.push(core);
        return core;
      },
      fetchImpl,
      now: () => new Date('2026-09-28T12:00:00Z'),
    };
    const created = createAgentGateway(deps, {
      enabled: config.enabled ?? true,
      ...(config.retryBaseDelayMs === undefined
        ? {}
        : { retryBaseDelayMs: config.retryBaseDelayMs }),
    });
    gateway = created;
    return { gateway, logger };
  }

  function completionFetch(content = 'AI says hi'): { fetchImpl: FetchLike; calls: Call[] } {
    const calls: Call[] = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(completionResponse(content));
    };
    return { fetchImpl, calls };
  }

  interface Call {
    url: string;
    init: RequestInit;
  }

  function bodyOf(call: Call): {
    model: string;
    messages: Array<{ role: string; content: string }>;
  } {
    return JSON.parse(String(call.init.body)) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
  }

  async function coreFor(cores: FakeCore[], aiJid: string): Promise<FakeCore> {
    for (const core of cores) {
      const identity = await core.options.getToken();
      if (identity.jid === aiJid) {
        return core;
      }
    }
    throw new Error(`no core for ${aiJid}`);
  }

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
      await context.db
        .insert(user)
        .values({ id: ownerId, name: 'Creator', email: `${ownerId}@example.com` });
      const connectionId = randomUUID();
      await context.db.insert(providerConnections).values({
        id: connectionId,
        owner: ownerId,
        provider: 'openai',
        encryptedKey: createKeyCipher(MASTER_KEY).encrypt(PROVIDER_KEY),
        label: null,
      });
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

      await context.db.update(ais).set({ status: 'disabled' }).where(eq(ais.id, seeded.aiId));
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

  describe('service additions', () => {
    it('create and delete emit lifecycle events the gateway observes', async () => {
      const seen: Array<{ type: string; aiId: string }> = [];
      const unsubscribe = onAiLifecycle((event) => {
        seen.push(event);
      });
      try {
        const ownerId = randomUUID();
        await context.db
          .insert(user)
          .values({ id: ownerId, name: 'Emitter', email: `${ownerId}@example.com` });
        const connectionId = randomUUID();
        await context.db.insert(providerConnections).values({
          id: connectionId,
          owner: ownerId,
          provider: 'openai',
          encryptedKey: createKeyCipher(MASTER_KEY).encrypt(PROVIDER_KEY),
          label: null,
        });
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
