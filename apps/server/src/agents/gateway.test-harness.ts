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
import type { FetchLike } from '../ai/http';
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

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// One OpenAI-compatible SSE chunk. The transport always streams (`stream: true`),
// so every model fake answers with these.
function sseChunk(delta: Record<string, unknown>, finishReason: string | null): string {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

function usageChunk(): string {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test-model',
    choices: [],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  })}\n\n`;
}

export function sseResponse(events: readonly string[]): Response {
  return new Response(events.join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

export function completionResponse(content: string): Response {
  return sseResponse([
    sseChunk({ content }, null),
    sseChunk({}, 'stop'),
    usageChunk(),
    'data: [DONE]\n\n',
  ]);
}

export function toolCallResponse(id: string, name: string, argsJson: string): Response {
  return sseResponse([
    sseChunk(
      { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: argsJson } }] },
      'tool_calls',
    ),
    usageChunk(),
    'data: [DONE]\n\n',
  ]);
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
  corrections: Array<{
    chatJid: string;
    kind: ChatKind;
    originalId: string;
    text: string;
    opts?: unknown;
  }> = [];
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
    opts?: unknown,
  ): Promise<{ id: string }> {
    this.corrections.push({ chatJid, kind, originalId, text, opts });
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
  overrides: { name?: string; computerMode?: 'off' | 'cloud' } = {},
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
        provider: 'deepseek',
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
        model: 'deepseek-chat',
        localpart,
        jid: aiJid,
        status: 'active',
        computer_mode: overrides.computerMode ?? 'off',
      })}`;
      yield* sql`INSERT INTO ai_limits ${sql.insert({
        ai_id: aiId,
        per_day_usd: '1.00',
        per_month_usd: '20.00',
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
      desk?: AgentGatewayDeps['desk'];
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
      cipher: createKeyCipher(MASTER_KEY),
      logger,
      turnLogger,
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
      ...(config.desk === undefined ? {} : { desk: config.desk }),
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
