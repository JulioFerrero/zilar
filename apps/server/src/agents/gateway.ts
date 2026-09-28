import {
  createXmppCore,
  type ChatMessage,
  type XmppCore,
  type XmppCoreOptions,
} from '@galena/xmpp-core';
import { and, eq } from 'drizzle-orm';
import {
  DEFAULT_LITELLM_BASE_URL,
  redactSecrets,
  type FetchLike,
  type LitellmAdminClient,
} from '../ai/litellm-client';
import { modelNameForAi } from '../ai/model-entry';
import {
  ensureAiModel,
  listActiveAisForGateway,
  onAiLifecycle,
  type ActiveAiForGateway,
  type AiServiceDeps,
} from '../ais/service';
import type { KeyCipher } from '../connections/crypto';
import type { ServerDatabase } from '../db/client';
import { ais, llmVirtualKeys, user } from '../db/schema';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import type { XmppConfig } from '../xmpp/config';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import { issueXmppToken } from '../xmpp/token';
import {
  bareJid,
  buildDmMessages,
  DM_HISTORY_MESSAGE_LIMIT,
  type ChatCompletionMessage,
} from './context';
import { mapFailureToReply, runDmTurn } from './reply';

export interface GatewayLogger {
  info: (fields: Record<string, unknown>, message: string) => void;
  warn: (fields: Record<string, unknown>, message: string) => void;
}

export interface AgentGatewayDeps {
  db: ServerDatabase;
  xmpp: XmppConfig;
  adminClient: EjabberdAdminClient;
  /** Absent when LiteLLM is not configured: the gateway stays off. */
  litellm?: LitellmAdminClient;
  /** Absent when the key master key is not configured: the gateway stays off. */
  cipher?: KeyCipher;
  logger: GatewayLogger;
  litellmBaseUrl?: string;
  /** Only used to redact log lines; never sent anywhere. */
  masterKeyForRedaction?: string;
  createCore?: (options: XmppCoreOptions) => XmppCore;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

export interface AgentGatewayConfig {
  enabled: boolean;
  reconcileIntervalMs?: number;
  retryBaseDelayMs?: number;
}

// Safety net: a missed notifier event is picked up at most this late.
export const RECONCILE_INTERVAL_MS = 60_000;

// First reconnect delay after a failed connect; doubles per attempt.
export const RETRY_BASE_DELAY_MS = 5_000;
export const RETRY_MAX_DELAY_MS = 60_000;

// Fresh-token TTL for each AI login. xmpp-core asks `getToken` on every
// (re)connect, so no connection ever runs on a stale token.
const XMPP_TOKEN_TTL_SECONDS = 300;

interface PendingMessage {
  id: string;
  body: string;
  fromJid: string;
}

interface AiSession {
  aiId: string;
  aiJid: string;
  core: XmppCore;
  busy: boolean;
  pending: PendingMessage[];
  stopped: boolean;
  retryAttempt: number;
  retryTimer: ReturnType<typeof setTimeout> | undefined;
  unsubs: Array<() => void>;
}

export interface AgentGateway {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** The periodic safety net, exposed so tests can drive it directly. */
  reconcile: () => Promise<void>;
  size: () => number;
  aiIds: () => string[];
}

function isAiSender(bare: string): boolean {
  return (bare.split('@')[0] ?? '').startsWith('ai-');
}

function retryDelayMs(attempt: number, baseMs: number): number {
  return Math.min(baseMs * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS);
}

function toRedactedError(error: unknown, secrets: readonly string[]): Error {
  if (error instanceof Error) {
    const redacted = new Error(redactSecrets(error.message, secrets));
    redacted.name = error.name;
    redacted.stack = redactSecrets(error.stack ?? '', secrets);
    return redacted;
  }
  return new Error(redactSecrets(String(error), secrets));
}

async function loadActiveAi(db: ServerDatabase, aiId: string): Promise<ActiveAiForGateway | null> {
  const [row] = await db
    .select({
      id: ais.id,
      jid: ais.jid,
      localpart: ais.localpart,
      owner: ais.owner,
      name: ais.name,
      persona: ais.persona,
    })
    .from(ais)
    .where(and(eq(ais.id, aiId), eq(ais.status, 'active')))
    .limit(1);
  return row ?? null;
}

async function loadOwnerName(db: ServerDatabase, ownerId: string): Promise<string> {
  const [row] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, ownerId))
    .limit(1);
  const name = row?.name?.trim() ?? '';
  return name === '' ? 'owner' : name;
}

// Agent gateway v0: keeps every active AI online over XMPP and replies to the
// AI's owner in their DM. The AI id always comes from the gateway's own
// connection map, never from message content. Reconnects are xmpp-core's own
// auto-reconnect plus this module's backoff on failed connects and the
// periodic reconcile as a safety net.
export function createAgentGateway(
  deps: AgentGatewayDeps,
  config: AgentGatewayConfig,
): AgentGateway {
  const logger = deps.logger;
  const reconcileIntervalMs = config.reconcileIntervalMs ?? RECONCILE_INTERVAL_MS;
  const retryBaseMs = config.retryBaseDelayMs ?? RETRY_BASE_DELAY_MS;
  const createCore = deps.createCore ?? createXmppCore;
  const baseUrl = deps.litellmBaseUrl ?? DEFAULT_LITELLM_BASE_URL;
  const sessions = new Map<string, AiSession>();

  let started = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;

  function aiDeps(): AiServiceDeps {
    return {
      db: deps.db,
      adminClient: deps.adminClient,
      // Checked in `start`: both are present whenever a session runs.
      litellm: deps.litellm as LitellmAdminClient,
      cipher: deps.cipher as KeyCipher,
      logger,
      domain: deps.xmpp.domain,
    };
  }

  function secretsFor(virtualKey?: string): string[] {
    return [
      ...(virtualKey === undefined ? [] : [virtualKey]),
      ...(deps.masterKeyForRedaction === undefined ? [] : [deps.masterKeyForRedaction]),
    ];
  }

  function scheduleRetry(session: AiSession): void {
    if (session.stopped || sessions.get(session.aiId) !== session) {
      return;
    }
    session.retryAttempt += 1;
    const delay = retryDelayMs(session.retryAttempt, retryBaseMs);
    if (session.retryTimer !== undefined) {
      clearTimeout(session.retryTimer);
    }
    session.retryTimer = setTimeout(() => {
      session.retryTimer = undefined;
      if (session.stopped || sessions.get(session.aiId) !== session) {
        return;
      }
      void session.core
        .connect()
        .then(() => {
          session.retryAttempt = 0;
        })
        .catch((error: unknown) => {
          logger.warn(
            { err: toRedactedError(error, secretsFor()), aiId: session.aiId },
            'AI reconnect failed; retrying',
          );
          scheduleRetry(session);
        });
    }, delay);
  }

  async function connectAi(record: ActiveAiForGateway): Promise<void> {
    if (!started || sessions.has(record.id)) {
      return;
    }
    const aiId = record.id;
    const aiJid = record.jid;
    let core: XmppCore;
    try {
      core = createCore({
        service: deps.xmpp.wsPublicUrl,
        domain: deps.xmpp.domain,
        getToken: async () => {
          const issued = await issueXmppToken(deps.xmpp, aiJid, XMPP_TOKEN_TTL_SECONDS);
          return { jid: aiJid, token: issued.token };
        },
      });
    } catch (error) {
      logger.warn(
        { err: toRedactedError(error, secretsFor()), aiId },
        'AI client could not be created',
      );
      return;
    }

    const session: AiSession = {
      aiId,
      aiJid,
      core,
      busy: false,
      pending: [],
      stopped: false,
      retryAttempt: 0,
      retryTimer: undefined,
      unsubs: [],
    };
    sessions.set(aiId, session);
    session.unsubs.push(
      core.on('message', (message) => {
        handleIncoming(session, message);
      }),
      core.on('status', (status) => {
        // Tokens never appear here: only the AI id is logged.
        if (status === 'online') {
          logger.info({ aiId }, 'AI is online');
        } else if (status === 'offline') {
          logger.warn({ aiId }, 'AI is offline');
        }
      }),
    );

    try {
      await core.connect();
      session.retryAttempt = 0;
    } catch (error) {
      // One AI failing to connect must never stop the others; the retry
      // timer and the reconcile loop pick it up later.
      logger.warn(
        { err: toRedactedError(error, secretsFor()), aiId },
        'AI failed to connect; retrying',
      );
      scheduleRetry(session);
      return;
    }
    // The gateway may have stopped while the login was in flight: never keep
    // a connection nobody owns any more.
    if (!started || session.stopped || sessions.get(aiId) !== session) {
      await disconnectAi(aiId).catch(() => undefined);
    }
  }

  async function disconnectAi(aiId: string): Promise<void> {
    const session = sessions.get(aiId);
    if (session === undefined) {
      return;
    }
    sessions.delete(aiId);
    session.stopped = true;
    if (session.retryTimer !== undefined) {
      clearTimeout(session.retryTimer);
      session.retryTimer = undefined;
    }
    for (const unsub of session.unsubs) {
      try {
        unsub();
      } catch {
        // Unsubscribing is best-effort during shutdown.
      }
    }
    session.unsubs = [];
    try {
      await session.core.disconnect();
    } catch (error) {
      logger.warn({ err: toRedactedError(error, secretsFor()), aiId }, 'AI disconnect failed');
    }
    logger.info({ aiId }, 'AI is offline');
  }

  async function reconcile(): Promise<void> {
    let active: ActiveAiForGateway[];
    try {
      active = await listActiveAisForGateway(deps.db);
    } catch (error) {
      logger.warn({ err: toRedactedError(error, secretsFor()) }, 'AI reconcile failed');
      return;
    }
    const wanted = new Set(active.map((ai) => ai.id));
    for (const ai of active) {
      try {
        await connectAi(ai);
      } catch (error) {
        logger.warn(
          { err: toRedactedError(error, secretsFor()), aiId: ai.id },
          'AI reconcile connect failed',
        );
      }
    }
    for (const aiId of sessions.keys()) {
      if (!wanted.has(aiId)) {
        try {
          await disconnectAi(aiId);
        } catch (error) {
          logger.warn(
            { err: toRedactedError(error, secretsFor()), aiId },
            'AI reconcile disconnect failed',
          );
        }
      }
    }
  }

  function handleIncoming(session: AiSession, message: ChatMessage): void {
    if (session.stopped || sessions.get(session.aiId) !== session) {
      return;
    }
    // v0 answers DMs only. Groups, own messages and empty bodies are ignored
    // before any database or model work.
    if (message.kind !== 'chat' || message.outgoing) {
      return;
    }
    const body = message.body?.trim() ?? '';
    if (body === '') {
      return;
    }
    session.pending.push({ id: message.id, body, fromJid: message.fromJid });
    void pumpSession(session);
  }

  // One turn at a time per AI. Messages arriving during a turn are coalesced:
  // when the turn ends, one more turn runs if new owner messages came in.
  async function pumpSession(session: AiSession): Promise<void> {
    if (session.busy) {
      return;
    }
    session.busy = true;
    try {
      while (session.pending.length > 0 && !session.stopped) {
        const batch = session.pending.splice(0, session.pending.length);
        await runSessionTurn(session, batch);
      }
    } finally {
      session.busy = false;
    }
  }

  async function runSessionTurn(session: AiSession, batch: PendingMessage[]): Promise<void> {
    // The owner JID comes from the database, never from the message. The AI
    // id below is the gateway's own: it keyed this session, so `ensureAiModel`
    // can never be aimed at an id taken from message content.
    const ai = await loadActiveAi(deps.db, session.aiId).catch(() => null);
    if (ai === null) {
      await disconnectAi(session.aiId).catch(() => undefined);
      return;
    }
    const ownerJid = jidFor(localpartFor(ai.owner), deps.xmpp.domain);
    const ownerBare = bareJid(ownerJid);
    // The owner always wins; other `ai-*` senders get no turn (which rules
    // out AI-to-AI loops) and strangers get none either.
    const ownerMessages: PendingMessage[] = [];
    for (const item of batch) {
      const from = bareJid(item.fromJid);
      if (from === ownerBare) {
        ownerMessages.push(item);
      } else if (isAiSender(from)) {
        // Another AI (or our own reflection): never a turn, never a loop.
      }
      // Anything else is a stranger and is ignored.
    }
    if (ownerMessages.length === 0) {
      // Strangers, other `ai-*` senders (no AI-to-AI loops) and anything else
      // get no turn and no LiteLLM call.
      return;
    }
    const trigger = ownerMessages[ownerMessages.length - 1] as PendingMessage;

    let virtualKey: string | undefined;
    try {
      await ensureAiModel(aiDeps(), session.aiId);
      const [keyRow] = await deps.db
        .select({ encryptedKey: llmVirtualKeys.encryptedKey })
        .from(llmVirtualKeys)
        .where(eq(llmVirtualKeys.aiId, session.aiId))
        .limit(1);
      if (!keyRow) {
        throw new Error(`AI ${session.aiId} has no virtual key`);
      }
      // Decrypted in memory only; never stored, logged or returned.
      virtualKey = (deps.cipher as KeyCipher).decrypt(keyRow.encryptedKey);

      let history: ChatMessage[] = [];
      try {
        const page = await session.core.loadHistory(ownerJid, 'chat', {
          max: DM_HISTORY_MESSAGE_LIMIT,
        });
        history = page.messages;
      } catch (historyError) {
        logger.warn(
          { err: toRedactedError(historyError, secretsFor(virtualKey)), aiId: session.aiId },
          'AI history lookup failed; replying without history',
        );
      }

      const ownerName = await loadOwnerName(deps.db, ai.owner);
      const now = (deps.now ?? (() => new Date()))();
      const today = now.toISOString().slice(0, 10);
      // The batch is newer than the archive may know: merge the triggering
      // messages into the history (skipping ids MAM already returned) so a
      // coalesced turn sees every message that arrived, and the trigger below
      // deduplicates against the last one by id.
      const knownIds = new Set(history.map((message) => message.id));
      const fresh: ChatMessage[] = ownerMessages
        .filter((item) => !knownIds.has(item.id))
        .map((item) => ({
          id: item.id,
          chatJid: session.aiJid,
          kind: 'chat' as const,
          fromJid: ownerJid,
          fromResolved: true,
          body: item.body,
          timestamp: now,
          outgoing: false,
        }));
      const messages: ChatCompletionMessage[] = buildDmMessages({
        aiName: ai.name,
        persona: ai.persona,
        ownerName,
        today,
        aiJid: ai.jid,
        ownerJid,
        history: [...history, ...fresh],
        trigger,
      });

      await runDmTurn({
        aiId: session.aiId,
        ownerJid,
        messages,
        baseUrl: baseUrl,
        virtualKey,
        model: modelNameForAi(session.aiId),
        ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
        sendMessage: (to, kind, text) => session.core.sendMessage(to, kind, text),
        sendTyping: (to, kind, state) => {
          session.core.sendTyping(to, kind, state);
        },
        logger,
        secrets: secretsFor(),
      });
    } catch (error) {
      // ensureAiModel, the key lookup and anything else outside the turn: an
      // honest short message, never the raw error.
      logger.warn(
        { err: toRedactedError(error, secretsFor(virtualKey)), aiId: session.aiId },
        'AI turn failed',
      );
      const reply = mapFailureToReply(error);
      try {
        await session.core.sendMessage(ownerJid, 'chat', reply);
      } catch {
        // There is nobody left to tell when the send itself fails.
      }
      try {
        session.core.sendTyping(ownerJid, 'chat', 'paused');
      } catch {
        // Typing state is best-effort.
      }
    }
  }

  async function start(): Promise<void> {
    if (started) {
      return;
    }
    if (!config.enabled) {
      logger.info({}, 'agent gateway is disabled');
      return;
    }
    if (deps.litellm === undefined || deps.cipher === undefined) {
      logger.warn({}, 'agent gateway needs LiteLLM and the key cipher; staying off');
      return;
    }
    started = true;
    await reconcile();
    unsubscribe = onAiLifecycle((event) => {
      if (!started) {
        return;
      }
      if (event.type === 'created') {
        void loadActiveAi(deps.db, event.aiId)
          .then((record) => {
            if (record !== null) {
              return connectAi(record);
            }
          })
          .catch((error: unknown) => {
            logger.warn(
              { err: toRedactedError(error, secretsFor()), aiId: event.aiId },
              'AI post-create connect failed',
            );
          });
      } else {
        void disconnectAi(event.aiId).catch((error: unknown) => {
          logger.warn(
            { err: toRedactedError(error, secretsFor()), aiId: event.aiId },
            'AI post-delete disconnect failed',
          );
        });
      }
    });
    timer = setInterval(() => {
      if (started) {
        void reconcile();
      }
    }, reconcileIntervalMs);
  }

  async function stop(): Promise<void> {
    started = false;
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
    if (unsubscribe !== undefined) {
      try {
        unsubscribe();
      } catch {
        // Unsubscribing is best-effort during shutdown.
      }
      unsubscribe = undefined;
    }
    for (const aiId of sessions.keys()) {
      try {
        await disconnectAi(aiId);
      } catch {
        // Shutdown disconnects everyone; one failure stops nothing else.
      }
    }
  }

  return {
    start,
    stop,
    reconcile,
    size: () => sessions.size,
    aiIds: () => [...sessions.keys()],
  };
}
