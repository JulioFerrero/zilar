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
import {
  failureLogFields,
  mapFailureToReply,
  runDmTurn,
  TRANSIENT_FAILURE_REPLY,
  type ExecuteToolCall,
} from '../reply';
import { buildTools } from '../tools';
import { TOOL_STAGE_THINKING } from '../tool-guide';
import type { createBudgetGate } from './budget';
import {
  isAiSender,
  toRedactedError,
  type AgentGatewayDeps,
  type AiSession,
  type GatewayLogger,
  type PendingMessage,
} from './contracts';
import { loadActiveAi, loadOwnerName } from './db';
import { loadModelTarget } from './model-target';
import type { DeskTurnContext } from './desk-exec';
import type { RequestActionContext } from './group-turn';
import { recordUsage } from '../../ais/usage-store';
import type { createLiveSession } from './live';
import type { MemoryRunner } from './memory';

type LiveSession = ReturnType<typeof createLiveSession>;

// T-0540 (plan §3, G7): the DM turn extracted from `createAgentGateway`. The
// factory takes the shared live session, budget gate, memory runner and the
// gateway callbacks the moved code closes over, and returns the same
// `pumpSessionEffect` the gateway forks. A pure move: no logic or wording changed.
interface DmTurnContext {
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
    turnLogger,
    sessionIsLive,
    liveSendMessage,
    liveSendTyping,
    liveMarkDisplayed,
    liveProgressReporter,
    budgetGate,
    loadMemoryContext,
    startCompaction,
    disconnectAi,
    secretsFor,
    executeToolCall,
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
        yield* runSessionTurnEffect(session, batch);
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
    // and the marker going out.
    liveMarkDisplayed(session, ownerJid, 'chat', trigger.id);

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
      return;
    }

    // Each turn streams its drafts to the owner under one turn id. The
    // publisher throttles (150 ms); the complete reply is flushed as a draft
    // right before the final XMPP send (`beforeFinalSend`), so the last
    // `draft` carries the final text; `end` always comes after the final XMPP
    // message below. Typing indicators stay exactly as before, for clients
    // without drafts.
    const turnDrafts = draftHub.publishTurn(ai.owner, ai.jid, randomUUID());
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
      const today = now.toISOString().slice(0, 10);
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
      // T-0106: multi-round turns post one live progress message at the
      // first tool round and update it per round; T-1414 turns it into a
      // task card edited in place, closed with a final `done`/`failed`
      // correction when the reply lands. Best effort: the turn never fails
      // over it.
      const dmProgress = liveProgressReporter(session, ownerJid, 'chat', ai.jid);
      // T-1409: offer the desk tools only when the AI's `computer_mode` is
      // `cloud` and a desk client is wired. The list and the executor see the
      // same flag, so a turn that did not advertise them refuses an improvised
      // call.
      const deskEnabled = deps.desk !== undefined && ai.computerMode === 'cloud';
      const outcome = yield* Effect.promise(() =>
        runDmTurn({
          aiId: session.aiId,
          ownerJid,
          messages: dmMessages,
          target,
          executeTool: executeToolCall(
            session,
            dmChatKey,
            undefined,
            deskEnabled ? { ownerUserId: ai.owner } : undefined,
          ),
          tools: buildTools(deps.actions?.listActions() ?? [], { desk: deskEnabled }),
          ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
          ...(deps.toolMaxRounds === undefined ? {} : { maxRounds: deps.toolMaxRounds }),
          checkRoundGate: () => budgetGate.checkDmRoundGate(session),
          reportProgress: dmProgress.reportProgress,
          finishProgress: dmProgress.finishProgress,
          // T-0156: wires the per-turn counts line (ids and counts only,
          // never content) into production — the wire the T-0106 review
          // deferred.
          turnLogger,
          onDelta: (textSoFar) => {
            if (sessionIsLive(session)) {
              turnDrafts.push(textSoFar);
            }
          },
          // T-1405: every model call in the turn adds its tokens and cost to
          // the AI's `ai_usage` row. Best effort and fire and forget; it can
          // never fail the turn.
          onUsage: (usage) => {
            void recordUsage(
              { db: deps.db, logger },
              session.aiId,
              target.provider,
              target.model,
              usage,
              (deps.now ?? (() => new Date()))(),
            );
          },
          beforeFinalSend: (text) => {
            if (sessionIsLive(session)) {
              turnDrafts.flush(text);
            }
          },
          sendMessage: (to, kind, text) => liveSendMessage(session, to, kind, text),
          // T-1406: a composing send opens the turn with the fixed "Thinking"
          // status; the tool stages replace it, and the final `paused` clears it.
          sendTyping: (to, kind, state) => {
            liveSendTyping(
              session,
              to,
              kind,
              state,
              state === 'composing' ? TOOL_STAGE_THINKING : undefined,
            );
          },
          logger,
          secrets: secretsFor(),
        }),
      );
      turnDrafts.end(outcome.kind === 'replied' && sessionIsLive(session) ? 'sent' : 'failed');
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
        Effect.gen(function* () {
          // The connection lookup and anything else outside the turn: an
          // honest short message, never the raw error.
          logger.warn({ ...failureLogFields(error), aiId: session.aiId }, 'AI turn failed');
          const reply = mapFailureToReply(error);
          // There is nobody left to tell when the send itself fails.
          yield* Effect.promise(() => liveSendMessage(session, ownerJid, 'chat', reply)).pipe(
            Effect.catchDefect(() => Effect.void),
          );
          // The failed `end` goes out only after the failure text was sent (or
          // its send was attempted): the contract promises `end` comes last.
          // Typing state is best-effort.
          yield* Effect.try({
            try: () => liveSendTyping(session, ownerJid, 'chat', 'paused'),
            catch: (typingError) => typingError,
          }).pipe(Effect.ignore);
          turnDrafts.end('failed');
        }),
      ),
    );
  });

  return { pumpSessionEffect };
}
