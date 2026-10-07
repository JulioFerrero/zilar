import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, and } from 'drizzle-orm';
import type {
  ChatKind,
  ChatMessage,
  ConnectionStatus,
  XmppCore,
  XmppCoreOptions,
} from '@zilar/xmpp-core';
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
import type { ActionGateway, RequestOutcome } from '../actions/gateway';
import type { ArchivePool } from '../search/service';
import type { GatewayLogger } from './gateway';
import {
  aiDailySpend,
  aiDelegations,
  aiLimits,
  aiMemoryFacts,
  aiMemoryMessages,
  aiMemoryNodes,
  ais,
  groupAis,
  groupMembers,
  groups,
  llmVirtualKeys,
  providerConnections,
  topicAis,
  topicMembers,
  topics,
  user,
} from '../db/schema';
import {
  createTestContext,
  TEST_XMPP_DOMAIN,
  TEST_XMPP_MUC_DOMAIN,
  type TestContext,
} from '../test-support';
import { emitGroupAi, emitTopicAi } from '../groups/events';
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
  type CompleteChatInput,
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
  corrections: Array<{ chatJid: string; kind: ChatKind; originalId: string; text: string }> = [];
  retractions: Array<{ chatJid: string; kind: ChatKind; targetId: string }> = [];
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

  sendCorrection(
    chatJid: string,
    kind: ChatKind,
    originalId: string,
    text: string,
  ): Promise<{ id: string }> {
    this.corrections.push({ chatJid, kind, originalId, text });
    return Promise.resolve({ id: 'sent-edit' });
  }

  sendRetraction(chatJid: string, kind: ChatKind, targetId: string): Promise<void> {
    this.retractions.push({ chatJid, kind, targetId });
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
      actions?: ActionGateway;
      toolsEnabled?: boolean;
      toolMaxRounds?: number;
      turnLogger?: GatewayLogger;
      archive?: ArchivePool;
      listener?: AgentGatewayDeps['listener'];
    } = {},
  ): {
    gateway: AgentGateway;
    logger: ReturnType<typeof captureLogger>;
    turnLogger: {
      info: (fields: Record<string, unknown>, message: string) => void;
      warn: (fields: Record<string, unknown>, message: string) => void;
    };
  } {
    const logger = captureLogger();
    const turnLogger =
      config.turnLogger ??
      ({
        info: (fields: Record<string, unknown>, message: string) => {
          logger.info(fields, message);
        },
        warn: (fields: Record<string, unknown>, message: string) => {
          logger.warn(fields, message);
        },
      } as {
        info: (fields: Record<string, unknown>, message: string) => void;
        warn: (fields: Record<string, unknown>, message: string) => void;
      });
    const failConnect = config.failConnect ?? (() => false);
    const deps: AgentGatewayDeps = {
      db: context.db,
      xmpp: context.xmppConfig,
      adminClient: context.adminClient,
      litellm,
      cipher: createKeyCipher(MASTER_KEY),
      logger,
      turnLogger,
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
      ...(config.actions === undefined ? {} : { actions: config.actions }),
      ...(config.toolsEnabled === undefined ? {} : { toolsEnabled: config.toolsEnabled }),
      ...(config.toolMaxRounds === undefined ? {} : { toolMaxRounds: config.toolMaxRounds }),
      ...(config.archive === undefined ? {} : { archive: config.archive }),
      ...(config.listener === undefined ? {} : { listener: config.listener }),
    };
    const created = createAgentGateway(deps, {
      enabled: config.enabled ?? true,
      ...(config.retryBaseDelayMs === undefined
        ? {}
        : { retryBaseDelayMs: config.retryBaseDelayMs }),
    });
    gateway = created;
    return { gateway, logger, turnLogger };
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

    it('reads pinned facts into a second system message', async () => {
      const seeded = await seedAi(context);
      await context.db.insert(aiMemoryFacts).values({
        id: randomUUID(),
        aiId: seeded.aiId,
        chatKey: `dm:${seeded.ownerJid}`,
        text: 'remember the deploy is Friday',
      });
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
      const rows = await context.db
        .select({ text: aiMemoryFacts.text })
        .from(aiMemoryFacts)
        .where(and(eq(aiMemoryFacts.aiId, aiId), eq(aiMemoryFacts.chatKey, chatKey)));
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
      await context.db.insert(aiMemoryFacts).values({
        id: randomUUID(),
        aiId: seeded.aiId,
        chatKey: `dm:${seeded.ownerJid}`,
        text: fact,
      });
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
      await context.db.insert(aiMemoryMessages).values([
        {
          aiId: seeded.aiId,
          chatKey,
          seq: 1,
          messageId: 'mine-1',
          at: new Date('2026-10-05T00:00:00Z'),
          sender: 'Owner',
          text: 'the launch is friday',
        },
        {
          aiId: seeded.aiId,
          chatKey,
          seq: 2,
          messageId: 'mine-2',
          at: new Date('2026-10-05T00:00:01Z'),
          sender: 'Gateway AI',
          text: 'noted, the launch is friday',
        },
        {
          aiId: seeded.aiId,
          chatKey: 'dm:someone-else',
          seq: 1,
          messageId: 'theirs-1',
          at: new Date('2026-10-05T00:00:02Z'),
          sender: 'Someone',
          text: 'the launch is in another chat',
        },
      ]);
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
      await context.db.insert(aiMemoryMessages).values(
        Array.from({ length: count }, (_, seq) => ({
          aiId,
          chatKey,
          seq,
          messageId: `${chatKey}-m${seq}`,
          at: new Date(Date.UTC(2026, 0, 1) + seq * 86_400_000),
          sender: 'Bob',
          text: `mirror-${seq}`,
          deleted: false,
        })),
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

      const nodes = await context.db
        .select({ lo: aiMemoryNodes.lo, hi: aiMemoryNodes.hi, summary: aiMemoryNodes.summary })
        .from(aiMemoryNodes)
        .where(and(eq(aiMemoryNodes.aiId, seeded.aiId), eq(aiMemoryNodes.chatKey, chatKey)));
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
      const nodes = await context.db
        .select({ lo: aiMemoryNodes.lo })
        .from(aiMemoryNodes)
        .where(and(eq(aiMemoryNodes.aiId, seeded.aiId), eq(aiMemoryNodes.chatKey, chatKey)));
      expect(nodes).toEqual([]);
    });
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
      await context.db.insert(topics).values({
        id: randomUUID(),
        groupId,
        name: 'General',
        glyph: 'G',
        roomLocalpart,
        visibility: 'public',
        kind: 'chat',
        status: 'open',
        isGeneral: true,
        createdBy: input.ownerId,
      });
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
      await context.db.insert(aiMemoryFacts).values({
        id: randomUUID(),
        aiId: seeded.aiId,
        chatKey: `room:${roomJid}`,
        text: 'the room rule is be brief',
      });

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
      const facts = await context.db
        .select({ text: aiMemoryFacts.text })
        .from(aiMemoryFacts)
        .where(
          and(eq(aiMemoryFacts.aiId, seeded.aiId), eq(aiMemoryFacts.chatKey, `room:${roomJid}`)),
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
          await context.db
            .insert(user)
            .values({ id: userId, name: m.name, email: `${userId}@example.com` });
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
        await context.db
          .insert(groups)
          .values({ id: groupId, roomLocalpart, title: 'Room', createdBy: creator.userId });
        await context.db
          .insert(groupMembers)
          .values(members.map((m) => ({ groupId, userId: m.userId, role: m.role })));
        await context.db
          .insert(groupAis)
          .values({ groupId, aiId: seeded.aiId, addedBy: creator.userId });
        const generalTopicId = randomUUID();
        await context.db.insert(topics).values({
          id: generalTopicId,
          groupId,
          name: 'General',
          glyph: 'G',
          roomLocalpart,
          visibility: 'public',
          kind: 'chat',
          status: 'open',
          isGeneral: true,
          createdBy: creator.userId,
        });
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
        const [before] = await context.db
          .select({ persona: ais.persona })
          .from(ais)
          .where(eq(ais.id, seeded.aiId));
        core.receive(memberMention(seeded, members[0]!, roomJid, 'm-1'));
        await waitFor(() => calls.length === 2);
        const second = JSON.parse(String(calls[1]!.init.body)) as {
          messages: Array<{ role: string; content: string }>;
        };
        const toolMessage = second.messages.find((message) => message.role === 'tool');
        expect(toolMessage?.content).toBe('invalid: unknown tool');
        const [after] = await context.db
          .select({ persona: ais.persona })
          .from(ais)
          .where(eq(ais.id, seeded.aiId));
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
        await context.db
          .delete(groupMembers)
          .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, carol.userId)));
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
        await context.db
          .insert(user)
          .values({ id: adminId, name: 'Bea', email: `${adminId}@example.com` });
        const adminJid = `${localpartFor(adminId)}@${TEST_XMPP_DOMAIN}`;
        const groupId = randomUUID();
        const roomLocalpart = `g98rev${randomUUID().replace(/-/g, '').slice(0, 7)}`;
        await context.db
          .insert(groups)
          .values({ id: groupId, roomLocalpart, title: 'Room', createdBy: adminId });
        await context.db.insert(groupMembers).values({ groupId, userId: adminId, role: 'admin' });
        await context.db.insert(groupAis).values({ groupId, aiId: seeded.aiId, addedBy: adminId });
        await context.db.insert(topics).values({
          id: randomUUID(),
          groupId,
          name: 'General',
          glyph: 'G',
          roomLocalpart,
          visibility: 'public',
          kind: 'chat',
          status: 'open',
          isGeneral: true,
          createdBy: adminId,
        });
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
        await context.db
          .update(groupMembers)
          .set({ role: 'member' })
          .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, adminId)));
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
        await context.db
          .insert(user)
          .values({ id: adminId, name: 'Bea', email: `${adminId}@example.com` });
        const adminJid = `${localpartFor(adminId)}@${TEST_XMPP_DOMAIN}`;
        const groupId = randomUUID();
        const roomLocalpart = `g98stop${randomUUID().replace(/-/g, '').slice(0, 7)}`;
        await context.db
          .insert(groups)
          .values({ id: groupId, roomLocalpart, title: 'Room', createdBy: adminId });
        await context.db.insert(groupMembers).values({ groupId, userId: adminId, role: 'admin' });
        await context.db.insert(groupAis).values({ groupId, aiId: seeded.aiId, addedBy: adminId });
        await context.db.insert(topics).values({
          id: randomUUID(),
          groupId,
          name: 'General',
          glyph: 'G',
          roomLocalpart,
          visibility: 'public',
          kind: 'chat',
          status: 'open',
          isGeneral: true,
          createdBy: adminId,
        });
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
      const [row] = await context.db
        .select({ persona: ais.persona })
        .from(ais)
        .where(eq(ais.id, first.aiId));
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
      await context.db.insert(user).values({ id: userId, name, email: `${userId}@example.com` });
      return { userId, jid: `${localpartFor(userId)}@${TEST_XMPP_DOMAIN}` };
    }

    async function seedGroupLocal(input: {
      ownerId: string;
      aiId: string;
      memberIds?: string[];
    }): Promise<{ groupId: string; roomJid: string }> {
      const groupId = randomUUID();
      const roomLocalpart = `gpost${randomUUID().replace(/-/g, '').slice(0, 9)}`;
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
      await context.db.insert(topics).values({
        id: randomUUID(),
        groupId,
        name: 'General',
        glyph: 'G',
        roomLocalpart,
        visibility: 'public',
        kind: 'chat',
        status: 'open',
        isGeneral: true,
        createdBy: input.ownerId,
      });
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
        await context.db
          .insert(user)
          .values({ id: userId, name: 'Ana', email: `${userId}@example.com` });
        return { userId, jid: `${localpartFor(userId)}@${TEST_XMPP_DOMAIN}` };
      })();
      const outsider = await (async () => {
        const userId = randomUUID();
        await context.db
          .insert(user)
          .values({ id: userId, name: 'Out', email: `${userId}@example.com` });
        return { userId, jid: `${localpartFor(userId)}@${TEST_XMPP_DOMAIN}` };
      })();
      const groupId = randomUUID();
      const generalLocalpart = `gtopic${randomUUID().replace(/-/g, '').slice(0, 10)}`;
      const topicLocalpart = `ttopic${randomUUID().replace(/-/g, '').slice(0, 10)}`;
      const visibility = input.visibility ?? 'public';
      const topicName = 'Backend';
      await context.db.insert(groups).values({
        id: groupId,
        roomLocalpart: generalLocalpart,
        title: 'Team',
        createdBy: seeded.ownerId,
      });
      await context.db.insert(groupMembers).values([
        { groupId, userId: seeded.ownerId, role: 'owner' },
        { groupId, userId: member.userId, role: 'member' },
        { groupId, userId: outsider.userId, role: 'member' },
      ]);
      await context.db
        .insert(groupAis)
        .values({ groupId, aiId: seeded.aiId, addedBy: seeded.ownerId });
      const generalId = randomUUID();
      await context.db.insert(topics).values({
        id: generalId,
        groupId,
        name: 'General',
        glyph: 'G',
        roomLocalpart: generalLocalpart,
        visibility: 'public',
        kind: 'chat',
        status: 'open',
        isGeneral: true,
        createdBy: seeded.ownerId,
      });
      const topicId = randomUUID();
      await context.db.insert(topics).values({
        id: topicId,
        groupId,
        name: topicName,
        glyph: 'B',
        roomLocalpart: topicLocalpart,
        visibility,
        kind: 'chat',
        status: 'open',
        isGeneral: false,
        createdBy: seeded.ownerId,
      });
      if (visibility === 'private') {
        await context.db.insert(topicMembers).values([
          { topicId, userId: seeded.ownerId, addedBy: seeded.ownerId },
          { topicId, userId: member.userId, addedBy: seeded.ownerId },
        ]);
      }
      if (input.withMember !== false) {
        await context.db
          .insert(topicAis)
          .values({ topicId, aiId: seeded.aiId, addedBy: seeded.ownerId });
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
      await context.db
        .delete(topicMembers)
        .where(and(eq(topicMembers.topicId, topicId), eq(topicMembers.userId, seeded.ownerId)));
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

      await context.db
        .insert(topicAis)
        .values({ topicId, aiId: seeded.aiId, addedBy: seeded.ownerId });
      emitTopicAi({ type: 'ai-added', topicId, aiId: seeded.aiId });
      await waitFor(() => core.joined.some((join) => join.roomJid === topicJid));

      await context.db
        .delete(topicAis)
        .where(and(eq(topicAis.topicId, topicId), eq(topicAis.aiId, seeded.aiId)));
      emitTopicAi({ type: 'ai-removed', topicId, aiId: seeded.aiId });
      await waitFor(() => core.left.includes(topicJid));
    });

    it('rejects a group admin who is not a member of a private topic, accepts one who is', async () => {
      const adminId = randomUUID();
      await context.db
        .insert(user)
        .values({ id: adminId, name: 'Bea', email: `${adminId}@example.com` });
      const adminJid = `${localpartFor(adminId)}@${TEST_XMPP_DOMAIN}`;
      const seeded = await seedAi(context, { name: 'Topic AI' });
      const groupId = randomUUID();
      const generalLocalpart = `gadm${randomUUID().replace(/-/g, '').slice(0, 11)}`;
      const topicLocalpart = `tadm${randomUUID().replace(/-/g, '').slice(0, 11)}`;
      await context.db.insert(groups).values({
        id: groupId,
        roomLocalpart: generalLocalpart,
        title: 'Team',
        createdBy: adminId,
      });
      await context.db.insert(groupMembers).values([
        { groupId, userId: adminId, role: 'admin' },
        { groupId, userId: seeded.ownerId, role: 'owner' },
      ]);
      await context.db
        .insert(groupAis)
        .values({ groupId, aiId: seeded.aiId, addedBy: seeded.ownerId });
      await context.db.insert(topics).values({
        id: randomUUID(),
        groupId,
        name: 'General',
        glyph: 'G',
        roomLocalpart: generalLocalpart,
        visibility: 'public',
        kind: 'chat',
        status: 'open',
        isGeneral: true,
        createdBy: adminId,
      });
      const topicId = randomUUID();
      await context.db.insert(topics).values({
        id: topicId,
        groupId,
        name: 'Hiring',
        glyph: 'H',
        roomLocalpart: topicLocalpart,
        visibility: 'private',
        kind: 'chat',
        status: 'open',
        isGeneral: false,
        createdBy: adminId,
      });
      await context.db.insert(topicMembers).values([
        { topicId, userId: adminId, addedBy: adminId },
        // The AI counts in a private room only while its owner is a topic
        // member too (derived rule): add the owner so the turn below runs.
        { topicId, userId: seeded.ownerId, addedBy: adminId },
      ]);
      await context.db
        .insert(topicAis)
        .values({ topicId, aiId: seeded.aiId, addedBy: seeded.ownerId });
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
      await context.db
        .delete(topicMembers)
        .where(and(eq(topicMembers.topicId, topicId), eq(topicMembers.userId, adminId)));
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
      await context.db
        .delete(topicAis)
        .where(and(eq(topicAis.topicId, topicId), eq(topicAis.aiId, seeded.aiId)));
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
      await context.db
        .insert(user)
        .values({ id: memberId, name: 'Ana', email: `${memberId}@example.com` });
      const memberJid = `${localpartFor(memberId)}@${TEST_XMPP_DOMAIN}`;
      const groupId = randomUUID();
      const generalLocalpart = `gsec${randomUUID().replace(/-/g, '').slice(0, 11)}`;
      const firstLocalpart = `tsec${randomUUID().replace(/-/g, '').slice(0, 11)}`;
      const secondLocalpart = `usec${randomUUID().replace(/-/g, '').slice(0, 11)}`;
      await context.db.insert(groups).values({
        id: groupId,
        roomLocalpart: generalLocalpart,
        title: 'Team',
        createdBy: seeded.ownerId,
      });
      await context.db.insert(groupMembers).values([
        { groupId, userId: seeded.ownerId, role: 'owner' },
        { groupId, userId: memberId, role: 'member' },
      ]);
      await context.db
        .insert(groupAis)
        .values({ groupId, aiId: seeded.aiId, addedBy: seeded.ownerId });
      await context.db.insert(topics).values({
        id: randomUUID(),
        groupId,
        name: 'General',
        glyph: 'G',
        roomLocalpart: generalLocalpart,
        visibility: 'public',
        kind: 'chat',
        status: 'open',
        isGeneral: true,
        createdBy: seeded.ownerId,
      });
      const firstId = randomUUID();
      await context.db.insert(topics).values({
        id: firstId,
        groupId,
        name: 'Backend Secrets',
        glyph: 'B',
        roomLocalpart: firstLocalpart,
        visibility: 'public',
        kind: 'chat',
        status: 'open',
        isGeneral: false,
        createdBy: seeded.ownerId,
      });
      const secondId = randomUUID();
      await context.db.insert(topics).values({
        id: secondId,
        groupId,
        name: 'Hiring Secrets',
        glyph: 'H',
        roomLocalpart: secondLocalpart,
        visibility: 'public',
        kind: 'chat',
        status: 'open',
        isGeneral: false,
        createdBy: seeded.ownerId,
      });
      await context.db.insert(topicAis).values([
        { topicId: firstId, aiId: seeded.aiId, addedBy: seeded.ownerId },
        { topicId: secondId, aiId: seeded.aiId, addedBy: seeded.ownerId },
      ]);
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

  describe('listener (T-0475)', () => {
    const NOW = new Date('2026-09-28T12:00:00Z');
    const LISTENER_VIRTUAL_KEY = 'sk-listener-key-do-not-leak';

    function listenerScores(aiId: string, score: number): string {
      return JSON.stringify({ scores: { [aiId]: score }, reason: 'one line', message_ids: [] });
    }

    async function seedMember(name: string): Promise<{ userId: string; jid: string }> {
      const userId = randomUUID();
      await context.db.insert(user).values({ id: userId, name, email: `${userId}@example.com` });
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
      await context.db.insert(groups).values({
        id: groupId,
        roomLocalpart,
        title: 'Room',
        createdBy: input.ownerId,
        ...(input.listenerEnabled === undefined ? {} : { listenerEnabled: input.listenerEnabled }),
        ...(input.eagerness === undefined ? {} : { listenerEagerness: input.eagerness }),
      });
      await context.db.insert(groupMembers).values([
        { groupId, userId: input.ownerId, role: 'owner' },
        ...(input.memberIds ?? []).map((userId) => ({
          groupId,
          userId,
          role: 'member' as const,
        })),
      ]);
      await context.db.insert(topics).values({
        id: randomUUID(),
        groupId,
        name: 'General',
        glyph: 'G',
        roomLocalpart,
        visibility: 'public',
        kind: 'chat',
        status: 'open',
        isGeneral: true,
        createdBy: input.ownerId,
      });
      return { groupId, roomJid: `${roomLocalpart}@${TEST_XMPP_MUC_DOMAIN}` };
    }

    async function addAiToGroup(groupId: string, ownerId: string, aiId: string): Promise<void> {
      await context.db.insert(groupAis).values({ groupId, aiId, addedBy: ownerId });
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
        await context.db.update(ais).set({ acceptsDelegation: accepts }).where(eq(ais.id, ai.aiId));
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
        await context.db.update(ais).set(flags).where(eq(ais.id, ai.aiId));
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

      function delegationRows() {
        return context.db.select().from(aiDelegations);
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
        await context.db.insert(aiDelegations).values({
          id: taskId,
          fromAiId: seeded.aiId,
          toAiId: worker.aiId,
          groupId,
          objective: 'a stored task',
        });
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
        await context.db.insert(aiDelegations).values({
          id: taskId,
          fromAiId: seeded.aiId,
          toAiId: worker.aiId,
          groupId,
          objective: 'a stored task',
          status: 'completed',
          resultSummary: 'the report is ready',
        });
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
        await context.db.insert(aiDelegations).values({
          id: taskId,
          fromAiId: seeded.aiId,
          toAiId: worker.aiId,
          groupId,
          objective: 'a stored task',
          status: 'completed',
          resultSummary: 'the report is ready',
        });
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
        await context.db
          .delete(groupAis)
          .where(and(eq(groupAis.groupId, groupId), eq(groupAis.aiId, worker.aiId)));
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
        await context.db.insert(aiDelegations).values({
          id: taskId,
          fromAiId: seeded.aiId,
          toAiId: worker.aiId,
          groupId,
          objective: 'a stored task',
          status: 'completed',
          resultSummary: 'the report is ready',
        });
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
        await context.db.insert(aiDelegations).values({
          id: taskId,
          fromAiId: seeded.aiId,
          toAiId: worker.aiId,
          groupId,
          objective: 'a stored task',
          status: 'completed',
          resultSummary: 'the report is ready',
        });

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
        await context.db.insert(aiDailySpend).values({
          aiId: worker.aiId,
          day: NOW.toISOString().slice(0, 10),
          baselineUsd: '0.00',
        });
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
