import { Effect } from 'effect';
import type { ChatMessage } from '@zilar/xmpp-core';
import { randomUUID } from 'node:crypto';
import type { DraftHub } from '../../drafts/hub';
import { jidFor, localpartFor } from '../../xmpp/provisioning';
import type { KeyCipher } from '../../connections/crypto';
import {
  bareJid,
  buildDmMessages,
  DM_HISTORY_MESSAGE_LIMIT,
  type ChatCompletionMessage,
} from '../context';
import { promptNow } from '../prompt-time';
import { timeZoneFor } from '../../auth/profile-time-zone';
import { TRANSIENT_FAILURE_REPLY, type ExecuteToolCall } from '../reply';
import type { createBudgetGate } from './budget';
import {
  isAiSender,
  toRedactedError,
  type AgentGatewayDeps,
  type AiSession,
  type GatewayLogger,
  type PendingMessage,
  type ScheduledTurnOutcome,
} from './contracts';
import { loadActiveAi, loadOwnerName } from './db';
import { loadModelTarget } from './model-target';
import { type DeskTurnContext } from './desk-exec';
import { runDmTurnInput } from './dm-turn-input';
import type { RequestActionContext } from './group-turn';
import { openTurnLog } from '../log/append';
import { settleFor } from './scheduled-settle';
import { reportDmTurnDefect } from './turn-defect';
import type { createLiveSession } from './live';
import type { MemoryRunner } from './memory';

type LiveSession = ReturnType<typeof createLiveSession>;

// T-0540 (plan §3, G7): the DM turn extracted from `createAgentGateway`. The
// factory takes the shared live session, budget gate, memory runner and the
// gateway callbacks the moved code closes over, and returns the same
// `pumpSessionEffect` the gateway forks. A pure move: no logic or wording changed.
export interface DmTurnContext {
  deps: AgentGatewayDeps;
  logger: GatewayLogger;
  turnLogger: GatewayLogger;
  sessionIsLive: LiveSession['sessionIsLive'];
  liveSendMessage: LiveSession['liveSendMessage'];
  liveSendTyping: LiveSession['liveSendTyping'];
  liveMarkDisplayed: LiveSession['liveMarkDisplayed'];
  liveProgressReporter: LiveSession['liveProgressReporter'];
  budgetGate: ReturnType<typeof createBudgetGate>;
  loadMemoryContext: MemoryRunner['loadMemoryContext'];
  startCompaction: MemoryRunner['startCompaction'];
  disconnectAi: (aiId: string) => Promise<void>;
  secretsFor: (secret?: string) => string[];
  executeToolCall: (
    session: AiSession,
    chatKey: string,
    context?: RequestActionContext,
    desk?: DeskTurnContext,
  ) => ExecuteToolCall;
  withToolGuide: (messages: ChatCompletionMessage[]) => ChatCompletionMessage[];
  draftHub: DraftHub;
}

export function createDmTurn(ctx: DmTurnContext) {
  const {
    deps,
    logger,
    sessionIsLive,
    liveSendMessage,
    liveSendTyping,
    liveMarkDisplayed,
    budgetGate,
    loadMemoryContext,
    startCompaction,
    disconnectAi,
    secretsFor,
    withToolGuide,
    draftHub,
  } = ctx;

  // One turn at a time per AI. Messages arriving during a turn are coalesced:
  // when the turn ends, one more turn runs if new owner messages came in.
  const pumpSessionEffect = Effect.fnUntraced(function* (
    session: AiSession,
  ): Effect.fn.Return<void> {
    if (session.busy) {
      return;
    }
    session.busy = true;
    yield* Effect.gen(function* () {
      while (session.pending.length > 0 && !session.stopped) {
        const batch = session.pending.splice(0, session.pending.length);
        const settle = settleFor(batch);
        yield* runSessionTurnEffect(session, batch, settle).pipe(
          Effect.ensuring(Effect.sync(() => settle('failed'))),
        );
      }
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          session.busy = false;
        }),
      ),
    );
  });

  // The Promise-typed calls below are lifted with plain `Effect.promise`: a
  // rejection (or a synchronous throw) dies with the original error, and
  // `catchDefect` handles it where the old code had a `catch`.
  const runSessionTurnEffect = Effect.fnUntraced(function* (
    session: AiSession,
    batch: PendingMessage[],
    settle: (outcome: ScheduledTurnOutcome) => void,
  ): Effect.fn.Return<void> {
    // The owner JID comes from the database, never from the message. The AI
    // id below is the gateway's own: it keyed this session, so the connection
    // lookup can never be aimed at an id taken from message content.
    const ai = yield* Effect.promise(() => loadActiveAi(deps.db, session.aiId)).pipe(
      Effect.catchDefect(() => Effect.succeed(null)),
    );
    if (ai === null) {
      yield* Effect.promise(() => disconnectAi(session.aiId)).pipe(
        Effect.catchDefect(() => Effect.void),
      );
      settle('offline');
      return;
    }
    const ownerJid = jidFor(localpartFor(ai.owner), deps.xmpp.domain);
    const ownerBare = bareJid(ownerJid);
    // The owner always wins; a scheduled routine's synthetic trigger counts as
    // the owner's. Other `ai-*` senders get no turn (which rules out AI-to-AI
    // loops) and strangers get none either.
    const ownerMessages: PendingMessage[] = [];
    for (const item of batch) {
      const from = bareJid(item.fromJid);
      if (item.scheduled !== undefined || from === ownerBare) {
        ownerMessages.push(item);
      } else if (isAiSender(from)) {
        // Another AI (or our own reflection): never a turn, never a loop.
      }
      // Anything else is a stranger and is ignored.
    }
    if (ownerMessages.length === 0) {
      // Strangers, other `ai-*` senders (no AI-to-AI loops) and anything else
      // get no turn and no model call.
      return;
    }
    const trigger = ownerMessages[ownerMessages.length - 1] as PendingMessage;

    // The owner's ticks turn to read: one XEP-0333 displayed marker per turn
    // for the last owner message of the batch. `trigger.id` is the incoming
    // `ChatMessage.id`, the same id the owner's client stores and matches
    // received markers against (the archive stanza-id when known, else the
    // stanza id). Only owner messages are ever marked: strangers and other
    // AIs returned above, before this point. The `liveMarkDisplayed` wrapper
    // drops the marker when the AI was stopped between the message arriving
    // and the marker going out. T-1642: a scheduled trigger has no real
    // incoming message to mark, so the marker is skipped for it.
    if (trigger.scheduled === undefined) {
      liveMarkDisplayed(session, ownerJid, 'chat', trigger.id);
    }

    // The soft daily limit holds even when the marker above already went out:
    // a limited AI answers with at most one notice per day, and further
    // messages that day get no reply and no notice. The usage read also
    // decides the 80% warnings, which go out after the reply below.
    const dmChatKey = `dm:${ownerBare}`;
    const dmBudget = yield* Effect.promise(() =>
      budgetGate.checkDailyLimit({
        aiId: session.aiId,
        chatKey: dmChatKey,
        sendNotice: (text) => liveSendMessage(session, ownerJid, 'chat', text),
      }),
    );
    if (dmBudget.limited) {
      settle('limited');
      return;
    }

    // Each turn streams its drafts to the owner under one turn id. The
    // publisher throttles (150 ms); the complete reply is flushed as a draft
    // right before the final XMPP send (`beforeFinalSend`), so the last
    // `draft` carries the final text; `end` always comes after the final XMPP
    // message below. Typing indicators stay exactly as before, for clients
    // without drafts.
    const turnDrafts = draftHub.publishTurn(ai.owner, ai.jid, randomUUID());
    const turnLog = openTurnLog(deps.db, logger, session.aiId, ai.owner, ownerBare, secretsFor());
    const turnBody = Effect.gen(function* () {
      const target = yield* Effect.promise(() =>
        loadModelTarget(deps.db, deps.cipher as KeyCipher, session.aiId),
      );
      if (target === null) {
        // No active provider connection for this AI: skip the turn with the
        // existing fixed failure text rather than throwing.
        logger.warn({ aiId: session.aiId }, 'AI turn skipped: no provider connection');
        yield* Effect.promise(() =>
          liveSendMessage(session, ownerJid, 'chat', TRANSIENT_FAILURE_REPLY),
        ).pipe(Effect.catchDefect(() => Effect.void));
        yield* Effect.try({
          try: () => liveSendTyping(session, ownerJid, 'chat', 'paused'),
          catch: (typingError) => typingError,
        }).pipe(Effect.ignore);
        turnDrafts.end('failed');
        settle('failed');
        return;
      }

      const history = yield* Effect.promise(() =>
        session.core.loadHistory(ownerJid, 'chat', {
          max: DM_HISTORY_MESSAGE_LIMIT,
        }),
      ).pipe(
        Effect.map((page): ChatMessage[] => page.messages),
        Effect.catchDefect((historyError) =>
          Effect.sync((): ChatMessage[] => {
            logger.warn(
              { err: toRedactedError(historyError, secretsFor(target.apiKey)), aiId: session.aiId },
              'AI history lookup failed; replying without history',
            );
            return [];
          }),
        ),
      );

      const ownerName = yield* Effect.promise(() => loadOwnerName(deps.db, ai.owner));
      const now = (deps.now ?? (() => new Date()))();
      const today = promptNow(now, yield* Effect.promise(() => timeZoneFor(deps.db, ai.owner)));
      const memory = yield* Effect.promise(() =>
        loadMemoryContext({
          aiId: session.aiId,
          chatKey: dmChatKey,
          archiveOwner: ai.localpart,
          scope: { kind: 'dm', peer: ownerBare },
          aiBareJid: bareJid(ai.jid),
          ownerName,
          now,
          secret: target.apiKey,
        }),
      );
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
        memory,
      });
      // T-0106: the guide rides as a trailing user turn only when tools are
      // enabled and tool/routine adapters are registered (a non-empty
      // action list, so `request_action` is actually offered). Otherwise
      // today's messages, byte for byte.
      const dmActionsList = deps.actions?.listActions() ?? [];
      const dmMessages =
        deps.toolsEnabled === true && dmActionsList.length > 0 ? withToolGuide(messages) : messages;

      // `end` always comes after the final XMPP message: `runDmTurn` sends
      // it before resolving. Every send and draft push is gated by a
      // `live*` wrapper so a stop that lands between the LLM call and the
      // final send drops the reply (and every draft) instead of delivering
      // it. The `end` itself runs unconditionally so the owner's client
      // sees the turn terminate instead of hanging.
      // T-0106/T-1414: multi-round turns post one task card, edited in place
      // and closed with a final `done`/`failed` correction. Best effort: the
      // turn never fails over it.
      const outcome = yield* runDmTurnInput({
        ctx,
        ai,
        session,
        ownerJid,
        messages: dmMessages,
        target,
        chatKey: dmChatKey,
        drafts: turnDrafts,
        log: turnLog,
      });
      turnDrafts.end(outcome.kind === 'replied' && sessionIsLive(session) ? 'sent' : 'failed');
      settle(outcome.kind);
      // The 80% heads-ups go out after the reply, so the owner reads the
      // answer first. A failed warning send only logs and never fails the
      // turn.
      yield* Effect.promise(() =>
        budgetGate.sendBudgetWarnings({
          aiId: session.aiId,
          chatKey: dmChatKey,
          usage: dmBudget.usage,
          sendWarning: (text) => liveSendMessage(session, ownerJid, 'chat', text),
        }),
      );
      startCompaction(session, dmChatKey, target);
    });
    yield* turnBody.pipe(
      Effect.catchDefect((error) =>
        reportDmTurnDefect({
          session,
          ownerJid,
          logger,
          turnLog,
          liveSendMessage,
          liveSendTyping,
          endDrafts: () => turnDrafts.end('failed'),
          error,
        }),
      ),
    );
  });

  return { pumpSessionEffect };
}
