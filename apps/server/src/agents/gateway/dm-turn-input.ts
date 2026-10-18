import { Effect } from 'effect';
import type { ActiveAiForGateway } from '../../ais/queries';
import { buildTools } from '../tools/definitions';
import { recordUsage } from '../../ais/usage-store';
import type { ModelTarget } from '../../ai/providers';
import type { ChatCompletionMessage } from '../context';
import { type DmTurnOutcome, runDmTurn } from '../dm-turn';
import { TOOL_STAGE_THINKING } from '../tool-guide';
import type { AiSession } from './contracts';
import { resolveTurnDesk, TOOL_STAGE_WAITING_FOR_YOUR_COMPUTER } from './desk-exec';
import { type DmTurnContext } from './dm-turn';
import { createRoutineSend } from './routine-send';
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
  scheduled?: boolean;
  scheduledRoutineId?: string;
}

export function runDmTurnInput(input: DmTurnInput): Effect.Effect<DmTurnOutcome> {
  const {
    ctx,
    ai,
    session,
    ownerJid,
    messages,
    target,
    chatKey,
    drafts,
    log,
    scheduled,
    scheduledRoutineId,
  } = input;
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
    const routineSend =
      scheduledRoutineId === undefined
        ? null
        : createRoutineSend({
            db: deps.db,
            session,
            routineId: scheduledRoutineId,
            isLive: sessionIsLive,
            now: deps.now ?? (() => new Date()),
            logger,
          });
    const dmProgress =
      routineSend === null ? liveProgressReporter(session, ownerJid, 'chat', ai.jid, log) : null;
    const turnDesk = yield* Effect.promise(() => resolveTurnDesk(deps, ai));
    if (turnDesk.waiting && dmProgress !== null) {
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
          { unattended: scheduled === true, dmJid: ownerJid },
        ),
        tools: buildTools(deps.actions?.listActions() ?? [], {
          desk: deskEnabled,
        }),
        ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
        ...turnLimits(deps.toolMaxRounds, deskEnabled),
        checkRoundGate: () => budgetGate.checkDmRoundGate(session),
        ...(dmProgress === null
          ? {}
          : {
              reportProgress: dmProgress.reportProgress,
              finishProgress: dmProgress.finishProgress,
            }),
        turnLogger,
        onDelta: (textSoFar) => {
          if (sessionIsLive(session)) {
            drafts.push(textSoFar);
          }
        },
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
        sendMessage: (to, kind, text) =>
          routineSend === null
            ? liveSendMessage(session, to, kind, text)
            : routineSend.send(to, kind, text),
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
