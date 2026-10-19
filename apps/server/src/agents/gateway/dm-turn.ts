import { Effect } from 'effect';
import { randomUUID } from 'node:crypto';
import type { DraftHub } from '../../drafts/hub';
import { jidFor, localpartFor } from '../../xmpp/provisioning';
import type { KeyCipher } from '../../connections/crypto';
import { bareJid, DM_HISTORY_MESSAGE_LIMIT, type ChatCompletionMessage } from '../context';
import { TRANSIENT_FAILURE_REPLY, type ExecuteToolCall } from '../tool-loop';
import type { createBudgetGate } from './budget';
import {
  isAiSender,
  type AgentGatewayDeps,
  type AiSession,
  type GatewayLogger,
  type PendingMessage,
  type ScheduledTurnOutcome,
} from './contracts';
import { loadModelTarget } from './model-target';
import type { DeskTurnContext } from './desk-exec';
import { runDmTurnInput } from './dm-turn-input';
import type { RequestActionContext } from './group-turn';
import { openTurnLog, type TurnLog } from '../log/append';
import { settleFor } from './scheduled-settle';
import { startTurn } from './turn-start';
import type { createLiveSession } from './live';
import type { MemoryRunner } from './memory';
import { failureLogFields, mapFailureToReply } from '../tool-exec';
import { loadTurnPrompt } from './turn-prompt';

type LiveSession = ReturnType<typeof createLiveSession>;

interface DmTurnDefectInput {
  session: AiSession;
  ownerJid: string;
  logger: GatewayLogger;
  turnLog: TurnLog;
  liveSendMessage: LiveSession['liveSendMessage'];
  liveSendTyping: LiveSession['liveSendTyping'];
  endDrafts: () => void;
  error: unknown;
  /** A scheduled routine's run posts no extra failure reply; the scheduler
   * records the failure instead. */
  scheduled?: boolean;
}

function reportDmTurnDefect(input: DmTurnDefectInput): Effect.Effect<void> {
  const {
    session,
    ownerJid,
    logger,
    turnLog,
    liveSendMessage,
    liveSendTyping,
    endDrafts,
    error,
    scheduled,
  } = input;
  return Effect.gen(function* () {
    // The connection lookup and anything else outside the turn: an honest
    // short message, never the raw error.
    logger.warn({ ...failureLogFields(error), aiId: session.aiId }, 'AI turn failed');
    turnLog.append('error', failureLogFields(error));
    // A scheduled run posts no extra message at all.
    if (scheduled !== true) {
      const reply = mapFailureToReply(error);
      // There is nobody left to tell when the send itself fails.
      yield* Effect.promise(() => liveSendMessage(session, ownerJid, 'chat', reply)).pipe(
        Effect.catchDefect(() => Effect.void),
      );
    }
    // The failed `end` goes out only after the failure text was sent (or its
    // send was attempted): the contract promises `end` comes last. Typing
    // state is best-effort.
    yield* Effect.try({
      try: () => liveSendTyping(session, ownerJid, 'chat', 'paused'),
      catch: (typingError) => typingError,
    }).pipe(Effect.ignore);
    endDrafts();
  });
}

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
    options?: { unattended?: boolean; dmJid?: string },
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
        // A scheduled routine's item is always its own turn, like the room
        // pump: it must settle its own outcome. Otherwise coalesce the run of
        // owner messages up to the first scheduled item.
        const first = session.pending[0] as PendingMessage;
        let take = 1;
        if (first.scheduled === undefined) {
          while (take < session.pending.length) {
            const item = session.pending[take];
            if (item === undefined || item.scheduled !== undefined) {
              break;
            }
            take += 1;
          }
        }
        const batch = session.pending.splice(0, take);
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
    const ai = yield* startTurn({ db: deps.db, disconnectAi }, session, batch, settle);
    if (ai === null) return;
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
      }
    }
    if (ownerMessages.length === 0) {
      return;
    }
    const trigger = ownerMessages[ownerMessages.length - 1] as PendingMessage;

    // The owner's ticks turn to read: one XEP-0333 displayed marker per turn
    // for the last owner message of the batch, using the id the owner's client
    // matches markers against. `liveMarkDisplayed` drops it when the AI was
    // stopped in between. A scheduled trigger has no message to mark, so it
    // marks the last real owner message instead.
    const lastOwnerMessage = [...ownerMessages]
      .reverse()
      .find((item) => item.scheduled === undefined);
    if (lastOwnerMessage !== undefined) {
      liveMarkDisplayed(session, ownerJid, 'chat', lastOwnerMessage.id);
    }

    // The soft daily limit holds even after the marker: a limited AI answers
    // with one notice per day, and further messages get no reply and no notice.
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

    // Each turn streams drafts under one turn id; the publisher throttles
    // (150 ms) and flushes the complete reply right before the final XMPP
    // send, so `end` always follows the final message.
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

      const messages = yield* Effect.promise(() =>
        loadTurnPrompt({
          ctx,
          ai,
          session,
          target,
          chat: { kind: 'dm', jid: ownerJid, key: dmChatKey, limit: DM_HISTORY_MESSAGE_LIMIT },
          items: ownerMessages,
          trigger,
        }),
      );
      // The guide rides as a trailing user turn only when tools are enabled
      // and tool/routine adapters are registered. A scheduled run offers
      // `request_action` but the unattended flag keeps it from parking a card.
      const dmActionsList = deps.actions?.listActions() ?? [];
      const dmMessages =
        deps.toolsEnabled === true && dmActionsList.length > 0 ? withToolGuide(messages) : messages;

      // `end` always comes after the final XMPP message. Every send and draft
      // push is gated by a `live*` wrapper so a stop drops the reply and every
      // draft instead of delivering it; `end` runs unconditionally so the
      // owner's client never hangs.
      // multi-round turns post one task card, edited in place
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
        // A routine's synthetic trigger offers the action tools again, but the
        // run is marked unattended so a tier-2 request without a standing rule
        // is refused instead of parking a card; the desk tools stay on.
        scheduled: trigger.scheduled !== undefined,
        // Carries the routine id, so the turn edits that routine's one message.
        ...(trigger.scheduled === undefined
          ? {}
          : { scheduledRoutineId: trigger.scheduled.routineId }),
      });
      const live = sessionIsLive(session);
      turnDrafts.end(outcome.kind === 'replied' && live ? 'sent' : 'failed');
      settle(outcome.kind === 'replied' && !live ? 'stopped' : outcome.kind);
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
          scheduled: trigger.scheduled !== undefined,
          error,
        }),
      ),
    );
  });

  return { pumpSessionEffect };
}
