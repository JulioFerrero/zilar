// T-1627 size split: the DM turn's desk resolution and `runDmTurn` input
// wiring, moved out of `dm-turn.ts` so no agent file reaches the 400-line cap.
// A pure move: the code, wording and behaviour are unchanged.
import { Effect } from 'effect';
import { type ActiveAiForGateway } from '../../ais/service';
import { recordUsage } from '../../ais/usage-store';
import type { ModelTarget } from '../../ai/providers';
import type { ChatCompletionMessage } from '../context';
import { type DmTurnOutcome } from '../dm-turn';
import { runDmTurn } from '../reply';
import { TOOL_STAGE_THINKING } from '../tool-guide';
import { buildTools } from '../tools';
import type { AiSession } from './contracts';
import { resolveTurnDesk, TOOL_STAGE_WAITING_FOR_YOUR_COMPUTER } from './desk-exec';
import { type DmTurnContext } from './dm-turn';
import type { DraftHub } from '../../drafts/hub';
import type { TurnLog } from '../log/append';
import { clearTurnAbort, registerTurnAbort } from './stop';
import { turnLimits } from './turn-rounds';

export interface DmTurnInput {
  ctx: DmTurnContext;
  ai: ActiveAiForGateway;
  session: AiSession;
  ownerJid: string;
  messages: ChatCompletionMessage[];
  target: ModelTarget;
  chatKey: string;
  drafts: ReturnType<DraftHub['publishTurn']>;
  log: TurnLog;
}

// T-1423: resolve the AI's computer for this turn (cloud or its runner).
// T-1409: the tools are offered only when it resolves to hands; the list and
// the executor see the same flag. T-1422: the turn's abort controller is keyed
// by the AI's own JID (the client chat id of an AI DM) and the stop route
// aborts it. Every send and draft push is gated by a `live*` wrapper so a stop
// that lands between the LLM call and the final send drops the reply instead
// of delivering it.
export function runDmTurnInput(input: DmTurnInput): Effect.Effect<DmTurnOutcome> {
  const { ctx, ai, session, ownerJid, messages, target, chatKey, drafts, log } = input;
  const {
    deps,
    logger,
    turnLogger,
    sessionIsLive,
    liveSendMessage,
    liveSendTyping,
    liveProgressReporter,
    budgetGate,
    secretsFor,
    executeToolCall,
  } = ctx;

  return Effect.gen(function* () {
    const dmProgress = liveProgressReporter(session, ownerJid, 'chat', ai.jid, log);
    const turnDesk = yield* Effect.promise(() => resolveTurnDesk(deps, ai));
    if (turnDesk.waiting) {
      yield* Effect.promise(() => dmProgress.reportProgress(TOOL_STAGE_WAITING_FOR_YOUR_COMPUTER));
    }
    const deskEnabled = turnDesk.client !== undefined;
    const dmAbort = registerTurnAbort(session, session.aiJid);
    const outcome = yield* Effect.promise(() =>
      runDmTurn({
        aiId: session.aiId,
        ownerJid,
        messages,
        target,
        signal: dmAbort.signal,
        executeTool: executeToolCall(
          session,
          chatKey,
          undefined,
          deskEnabled
            ? { ownerUserId: ai.owner, client: turnDesk.client, signal: dmAbort.signal }
            : undefined,
        ),
        tools: buildTools(deps.actions?.listActions() ?? [], { desk: deskEnabled }),
        ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
        ...turnLimits(deps.toolMaxRounds, deskEnabled),
        checkRoundGate: () => budgetGate.checkDmRoundGate(session),
        reportProgress: dmProgress.reportProgress,
        finishProgress: dmProgress.finishProgress,
        // T-0156: wires the per-turn counts line (ids and counts only, never
        // content) into production — the wire the T-0106 review deferred.
        turnLogger,
        onDelta: (textSoFar) => {
          if (sessionIsLive(session)) {
            drafts.push(textSoFar);
          }
        },
        // T-1405: every model call in the turn adds its tokens and cost to the
        // AI's `ai_usage` row. Best effort and fire and forget; it can never
        // fail the turn.
        onUsage: (usage) => {
          void recordUsage(
            { db: deps.db, logger },
            session.aiId,
            target.usageProvider ?? target.provider,
            target.model,
            usage,
            (deps.now ?? (() => new Date()))(),
          );
        },
        beforeFinalSend: (text) => {
          if (sessionIsLive(session)) {
            drafts.flush(text);
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
        log,
      }),
    ).pipe(Effect.ensuring(Effect.sync(() => clearTurnAbort(session, session.aiJid, dmAbort))));
    return outcome;
  });
}
