import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type {
  ChatKind,
  ChatMessage,
  ConnectionStatus,
  XmppCore,
  XmppCoreOptions,
} from '@zilar/xmpp-core';
import {
  LitellmApiError,
  type AddModelInput,
  type FetchLike,
  type GenerateVirtualKeyInput,
  type LitellmAdminClient,
  type ModelListing,
  type UpdateVirtualKeyInput,
  type VirtualKey,
  type VirtualKeyInfo,
} from '../ai/litellm-client';
import { createKeyCipher } from '../connections/crypto';
import type { ActionGateway } from '../actions/gateway';
import type { ArchivePool } from '../search/service';
import type { GatewayLogger } from './gateway';
import { TEST_XMPP_DOMAIN, testSql, type TestContext } from '../test-support';
import { localpartFor } from '../xmpp/provisioning';
import { aiLocalpart } from '../ais/service';
import { createAgentGateway, type AgentGateway, type AgentGatewayDeps } from './gateway';
import { type DraftHub } from '../drafts/hub';

export const MASTER_KEY = 'test-master-key-0000000000000000000000';
export const PROVIDER_KEY = 'sk-provider-key-do-not-leak';
export const VIRTUAL_KEY = 'sk-virtual-gateway-key-do-not-leak';

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function completionResponse(content: string): Response {
  return jsonResponse({ choices: [{ message: { content } }] });
}

export class FakeCore implements XmppCore {
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

export interface FakeLitellmOptions {
  /** Appended to the model and token ids, so a leak check can grep for it. */
  idSuffix?: string;
  /** The `maxBudget` that `getKeyInfo` answers. */
  keyInfoMaxBudget?: number | null;
}

/** One LiteLLM stand-in for the gateway, AI service, usage and routes tests. */
export class FakeLitellm implements LitellmAdminClient {
  readonly added: AddModelInput[] = [];
  /** The ids `addModel` handed out, in order. */
  readonly createdIds: string[] = [];
  readonly generated: GenerateVirtualKeyInput[] = [];
  readonly updated: UpdateVirtualKeyInput[] = [];
  readonly deleted: string[] = [];
  readonly revoked: string[] = [];
  /** Every model/key call in order, so tests can assert the swap ordering. */
  readonly order: string[] = [];
  /** The keys `getKeyInfo` was asked about, in order. */
  readonly seenKeys: string[] = [];
  /** Models `listModels` returns, so tests can plant a stray `ai-<id>`. */
  listed: ModelListing[] = [];
  /** Key spend `getKeyInfo` answers, by token id. Unset keys spend 0. */
  readonly spendByKey = new Map<string, number>();
  failKeyInfo = false;
  hangKeyInfo = false;
  failGenerate = false;
  failUpdate = false;
  failRevoke = false;
  failAdd = false;
  failDelete = false;
  private readonly idSuffix: string;
  private readonly keyInfoMaxBudget: number | null;
  private modelCounter = 0;
  private keyCounter = 0;

  constructor(options: FakeLitellmOptions = {}) {
    this.idSuffix = options.idSuffix ?? '';
    this.keyInfoMaxBudget = options.keyInfoMaxBudget === undefined ? 20 : options.keyInfoMaxBudget;
  }

  addModel(input: AddModelInput): Promise<string> {
    this.added.push(input);
    this.order.push('addModel');
    if (this.failAdd) {
      // Shaped like the real client's errors: redacted before throwing, so a
      // gateway that echoes keys back never reaches the service log.
      return Promise.reject(new LitellmApiError('model/new', 400, 'gateway down [redacted]'));
    }
    this.modelCounter += 1;
    const id = `model-${this.modelCounter}${this.idSuffix}`;
    this.createdIds.push(id);
    return Promise.resolve(id);
  }

  deleteModel(modelId: string): Promise<void> {
    this.order.push('deleteModel');
    if (this.failDelete) {
      return Promise.reject(new Error('gateway down'));
    }
    this.deleted.push(modelId);
    return Promise.resolve();
  }

  listModels(): Promise<ModelListing[]> {
    return Promise.resolve([...this.listed]);
  }

  generateKey(input: GenerateVirtualKeyInput): Promise<VirtualKey> {
    this.generated.push(input);
    this.order.push('generateKey');
    if (this.failGenerate) {
      return Promise.reject(new Error('gateway down, master was sk-master-must-not-leak'));
    }
    this.keyCounter += 1;
    return Promise.resolve({
      id: `tok-${this.keyCounter}${this.idSuffix}`,
      key: `sk-virtual-${this.keyCounter}-do-not-leak`,
      keyAlias: input.keyAlias ?? null,
      maxBudget: input.maxBudget ?? null,
      spend: 0,
      models: input.models,
    });
  }

  getKeyInfo(key: string): Promise<VirtualKeyInfo> {
    this.seenKeys.push(key);
    if (this.hangKeyInfo) {
      return new Promise<VirtualKeyInfo>(() => undefined);
    }
    if (this.failKeyInfo) {
      return Promise.reject(new Error('LiteLLM is down'));
    }
    return Promise.resolve({
      keyAlias: null,
      maxBudget: this.keyInfoMaxBudget,
      spend: this.spendByKey.get(key) ?? 0,
      tpmLimit: null,
      rpmLimit: null,
      blocked: null,
      models: [],
    });
  }

  updateKey(input: UpdateVirtualKeyInput): Promise<VirtualKeyInfo> {
    this.updated.push(input);
    this.order.push('updateKey');
    if (this.failUpdate) {
      return Promise.reject(new Error('gateway down'));
    }
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

  revokeKey(key: string): Promise<void> {
    this.revoked.push(key);
    if (this.failRevoke) {
      return Promise.reject(new Error('gateway down'));
    }
    return Promise.resolve();
  }
}

export function captureLogger() {
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
export function loggedText(
  calls: Array<{ fields: Record<string, unknown>; message: string }>,
): string {
  return calls
    .map((call) => {
      const err = call.fields['err'];
      const detail =
        err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : JSON.stringify(err);
      return `${call.message}\n${detail}`;
    })
    .join('\n');
}

export interface SeededAi {
  aiId: string;
  ownerId: string;
  ownerJid: string;
  aiJid: string;
}

export async function seedAi(
  context: TestContext,
  overrides: { modelId?: string | null; name?: string } = {},
): Promise<SeededAi> {
  const ownerId = randomUUID();
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO "user" ${sql.insert({
        id: ownerId,
        name: 'Owner',
        email: `${ownerId}@example.com`,
      })}`;
    }),
  );
  const connectionId = randomUUID();
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO provider_connections ${sql.insert({
        id: connectionId,
        owner: ownerId,
        provider: 'openai',
        encrypted_key: createKeyCipher(MASTER_KEY).encrypt(PROVIDER_KEY),
        label: null,
      })}`;
    }),
  );
  const aiId = randomUUID();
  const localpart = aiLocalpart(aiId);
  const aiJid = `${localpart}@${TEST_XMPP_DOMAIN}`;
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO ais ${sql.insert({
        id: aiId,
        owner: ownerId,
        name: overrides.name ?? 'Gateway AI',
        template: 'dev',
        persona: 'A helpful persona.',
        provider_connection_id: connectionId,
        model: 'gpt-4o-mini',
        localpart,
        jid: aiJid,
        status: 'active',
      })}`;
      yield* sql`INSERT INTO ai_limits ${sql.insert({
        ai_id: aiId,
        per_day_usd: '1.00',
        per_month_usd: '20.00',
      })}`;
      yield* sql`INSERT INTO llm_virtual_keys ${sql.insert({
        ai_id: aiId,
        litellm_key_id: 'tok-1',
        litellm_model_id: overrides.modelId === undefined ? 'model-1' : overrides.modelId,
        encrypted_key: createKeyCipher(MASTER_KEY).encrypt(VIRTUAL_KEY),
        budget_usd: '20.00',
        budget_duration: '30d',
      })}`;
    }),
  );
  return { aiId, ownerId, ownerJid: `${localpartFor(ownerId)}@${TEST_XMPP_DOMAIN}`, aiJid };
}

export function incoming(
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

export async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for the condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export function tick(ms = 100): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface Call {
  url: string;
  init: RequestInit;
}

export function createGatewayHelpers(access: {
  getContext: () => TestContext;
  setGateway: (gateway: AgentGateway) => void;
}) {
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
      db: access.getContext().db,
      xmpp: access.getContext().xmppConfig,
      adminClient: access.getContext().adminClient,
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
    access.setGateway(created);
    return { gateway: created, logger, turnLogger };
  }

  function completionFetch(content = 'AI says hi'): { fetchImpl: FetchLike; calls: Call[] } {
    const calls: Call[] = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(completionResponse(content));
    };
    return { fetchImpl, calls };
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
  return { harness, completionFetch, bodyOf, coreFor };
}
