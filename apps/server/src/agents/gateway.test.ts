import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, and } from 'drizzle-orm';
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
import {
  aiLimits,
  ais,
  groupAis,
  groupMembers,
  groups,
  llmVirtualKeys,
  providerConnections,
  user,
} from '../db/schema';
import {
  createTestContext,
  TEST_XMPP_DOMAIN,
  TEST_XMPP_MUC_DOMAIN,
  type TestContext,
} from '../test-support';
import { emitGroupAi } from '../groups/events';
import { localpartFor } from '../xmpp/provisioning';
import {
  aiLocalpart,
  createAi,
  deleteAi,
  onAiLifecycle,
  resumeAi,
  stopAi,
  type AiServiceDeps,
} from '../ais/service';
import {
  createAgentGateway,
  GATEWAY_RESOURCE,
  type AgentGateway,
  type AgentGatewayDeps,
} from './gateway';
import { createDraftHub, type DraftHub } from '../drafts/hub';
import type { DraftHubEvent } from '../drafts/events';
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
  failJoin = false;
  failLeave = false;
  sent: Array<{ to: string; kind: ChatKind; text: string; opts?: unknown }> = [];
  typing: Array<{ to: string; kind: ChatKind; state: 'composing' | 'paused' }> = [];
  displayed: Array<{ chatJid: string; kind: ChatKind; messageId: string }> = [];
  joined: Array<{ roomJid: string; nick: string }> = [];
  left: string[] = [];
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

  joinRoom(roomJid: string, nick: string): Promise<void> {
    if (this.failJoin) {
      return Promise.reject(new Error('muc is down'));
    }
    this.joined.push({ roomJid, nick });
    return Promise.resolve();
  }

  leaveRoom(roomJid: string): Promise<void> {
    if (this.failLeave) {
      return Promise.reject(new Error('muc is down'));
    }
    this.left.push(roomJid);
    return Promise.resolve();
  }

  occupants(): [] {
    return [];
  }

  async sendMessage(
    to: string,
    kind: ChatKind,
    text: string,
    opts?: unknown,
  ): Promise<{ id: string }> {
    if (this.failSend) {
      throw new Error('xmpp send is down');
    }
    this.sent.push({ to, kind, text, opts });
    return { id: `sent-${this.sent.length}` };
  }

  sendReactions(): Promise<void> {
    return Promise.resolve();
  }

  sendCorrection(): Promise<{ id: string }> {
    return Promise.resolve({ id: 'sent-edit' });
  }

  sendRetraction(): Promise<void> {
    return Promise.resolve();
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

  markDisplayed(chatJid: string, kind: ChatKind, messageId: string): void {
    this.displayed.push({ chatJid, kind, messageId });
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

  emitReplaced(): void {
    this.emit('replaced', undefined);
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
  /** Key spend `getKeyInfo` answers, by token id. Unset keys spend 0. */
  readonly spendByKey = new Map<string, number>();
  failKeyInfo = false;
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

  getKeyInfo(key: string): Promise<VirtualKeyInfo> {
    if (this.failKeyInfo) {
      return Promise.reject(new Error('LiteLLM is down'));
    }
    return Promise.resolve({
      keyAlias: null,
      maxBudget: 20,
      spend: this.spendByKey.get(key) ?? 0,
      tpmLimit: null,
      rpmLimit: null,
      blocked: null,
      models: [],
    });
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
      hub?: DraftHub;
      now?: () => Date;
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
      ...(config.now === undefined
        ? { now: () => new Date('2026-09-28T12:00:00Z') }
        : { now: config.now }),
      ...(config.hub === undefined ? {} : { drafts: { hub: config.hub } }),
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
      const [row] = await context.db
        .select({ persona: ais.persona, previousPersona: ais.previousPersona })
        .from(ais)
        .where(eq(ais.id, aiId))
        .limit(1);
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
      await context.db
        .update(ais)
        .set({ persona: NEW_PERSONA, previousPersona: OLD_PERSONA })
        .where(eq(ais.id, seeded.aiId));
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
      await context.db.update(ais).set({ persona: secretPersona }).where(eq(ais.id, seeded.aiId));
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
      await context.db.delete(llmVirtualKeys).where(eq(llmVirtualKeys.aiId, seeded.aiId));
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

  describe('groups', () => {
    const NOW = new Date('2026-09-28T12:00:00Z');

    async function seedMember(name: string): Promise<{ userId: string; jid: string }> {
      const userId = randomUUID();
      await context.db.insert(user).values({ id: userId, name, email: `${userId}@example.com` });
      return { userId, jid: `${localpartFor(userId)}@${TEST_XMPP_DOMAIN}` };
    }

    async function seedGroup(input: {
      ownerId: string;
      aiId: string;
      memberIds?: string[];
    }): Promise<{ groupId: string; roomJid: string }> {
      const groupId = randomUUID();
      const roomLocalpart = `gtest${randomUUID().replace(/-/g, '').slice(0, 10)}`;
      await context.db
        .insert(groups)
        .values({ id: groupId, roomLocalpart, title: 'Room', createdBy: input.ownerId });
      await context.db.insert(groupMembers).values([
        { groupId, userId: input.ownerId, role: 'owner' },
        ...(input.memberIds ?? []).map((userId) => ({
          groupId,
          userId,
          role: 'member' as const,
        })),
      ]);
      await context.db
        .insert(groupAis)
        .values({ groupId, aiId: input.aiId, addedBy: input.ownerId });
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

      await context.db
        .delete(groupAis)
        .where(and(eq(groupAis.groupId, groupId), eq(groupAis.aiId, seeded.aiId)));
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
      await context.db
        .delete(groupAis)
        .where(and(eq(groupAis.groupId, groupId), eq(groupAis.aiId, seeded.aiId)));
      emitGroupAi({ type: 'ai-removed', groupId, aiId: seeded.aiId });
      await waitFor(() => core.left.length === 1);
      await context.db
        .insert(groupAis)
        .values({ groupId, aiId: seeded.aiId, addedBy: seeded.ownerId });
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
      // No persona tools in groups.
      expect((bodyOf(call) as { tools?: unknown }).tools).toBeUndefined();
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

      await context.db
        .delete(groupAis)
        .where(and(eq(groupAis.groupId, groupId), eq(groupAis.aiId, seeded.aiId)));
      emitGroupAi({ type: 'ai-removed', groupId, aiId: seeded.aiId });
      await waitFor(() => core.left.length === 1);
      await context.db
        .insert(groupAis)
        .values({ groupId, aiId: seeded.aiId, addedBy: seeded.ownerId });
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
});
