import { Effect } from 'effect';
import type { ActiveAiForGateway } from '../../ais/queries';
import { buildTools } from '../tools/definitions';
import type { ModelTarget } from '../../ai/providers';
import type { ChatCompletionMessage } from '../context';
import { type DmTurnOutcome, runDmTurn } from '../dm-turn';
import type { AiSession } from './contracts';
import { type DmTurnContext } from './dm-turn';
import type { DraftHub } from '../../drafts/hub';
import type { TurnLog } from '../log/append';
import { prepareTurn } from './turn-wiring';

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
  return Effect.gen(function* () {
    const { routineSend, signal, common, deskOptions, deskEnabled, ensureCleared } =
      yield* prepareTurn({
        ctx,
        session,
        ai,
        target,
        chatJid: ownerJid,
        abortJid: session.aiJid,
        kind: 'chat',
        log,
        isLive: ctx.sessionIsLive,
        ...(scheduledRoutineId === undefined ? {} : { routineId: scheduledRoutineId }),
      });
    const outcome = yield* Effect.promise(() =>
      runDmTurn({
        ...common,
        aiId: session.aiId,
        ownerJid,
        messages,
        target,
        signal,
        executeTool: ctx.executeToolCall(session, chatKey, undefined, deskOptions, {
          unattended: scheduled === true,
          dmJid: ownerJid,
          signal,
        }),
        tools: buildTools(ctx.deps.actions?.listActions() ?? [], { desk: deskEnabled }),
        onDelta: (textSoFar) => {
          if (ctx.sessionIsLive(session)) drafts.push(textSoFar);
        },
        beforeFinalSend: (text) => {
          if (ctx.sessionIsLive(session)) drafts.flush(text);
        },
        sendMessage: (to, kind, text) =>
          routineSend === null
            ? ctx.liveSendMessage(session, to, kind, text)
            : routineSend.send(to, kind, text),
      }),
    ).pipe(Effect.ensuring(ensureCleared));
    return outcome;
  });
}
