// effect-plain: the turn adapters stay Promise-shaped over the shared tool loop.
import type { DmTurnDeps, DmTurnOutcome } from './dm-turn';
import { cutShortSuffix } from './replies';
import { actionOfCall } from './tool-exec';
import { TRANSIENT_FAILURE_REPLY, requestCompletion, type CompleteChatInput } from './tool-loop';
import { runToolLoop } from './tool-rounds';
import {
  finishProgressQuietly,
  finishTurnFailure,
  remainingTurnBudgetMs,
  sendReply,
  stoppedTurn,
  turnStopped,
  type TurnFailure,
} from './turn';
import type { ChatToolDefinition } from '../ai/model-client';

export { runToolLoop } from './tool-rounds';

export async function runToolTurn(
  deps: DmTurnDeps,
  completionInput: Omit<CompleteChatInput, 'messages' | 'tools' | 'maxTokens'>,
  secrets: string[],
  tools: ChatToolDefinition[],
): Promise<DmTurnOutcome> {
  const startedAt = deps.turnStartMs ?? (deps.nowMs ?? Date.now)();
  const nowMs = deps.nowMs ?? Date.now;
  const turnLogger = deps.turnLogger ?? { info: () => undefined };
  const maxRounds = deps.maxRounds ?? 1;
  let loop: Awaited<ReturnType<typeof runToolLoop>>;
  const withNotices = (reason: string): string => reason + loop.notices.join('');
  const failTurn = (failure: Omit<TurnFailure, 'send'>) =>
    finishTurnFailure(deps, secrets, {
      ...failure,
      send: (text) => deps.sendMessage(deps.ownerJid, 'chat', text),
    });
  try {
    loop = await runToolLoop({
      aiId: deps.aiId,
      messages: deps.messages,
      tools,
      completionInput,
      maxRounds,
      ...(deps.caps === undefined ? {} : { caps: deps.caps }),
      ...(deps.executeTool === undefined ? {} : { executeTool: deps.executeTool }),
      logger: deps.logger,
      turnLogger,
      secrets,
      ...(deps.checkRoundGate === undefined ? {} : { checkRoundGate: deps.checkRoundGate }),
      turnStartMs: startedAt,
      nowMs,
      ...(deps.reportProgress === undefined ? {} : { reportProgress: deps.reportProgress }),
      actionOf: (tool, argsJson) => actionOfCall(tool, argsJson),
      ...(deps.log === undefined ? {} : { log: deps.log }),
    });
  } catch (error) {
    // The loop throws only for an empty first reply or a failed model
    // call: the failure text goes out like any other model failure, with
    // no notices (none were earned yet).
    return await failTurn({ error, text: (reason) => reason });
  }
  if (loop.failure !== null) {
    return await failTurn({ reason: loop.failure.reply, text: withNotices });
  }
  if (loop.text === null) {
    // The caps stopped the loop with no text: one last call so the AI must
    // answer in text. The single-round shape offers tools on that
    // call and answers from its text alone; longer turns go tool-free.
    // The gate runs first: a stop or budget trip before the last call sends
    // the gate's fixed reply instead of another model call.
    if (deps.checkRoundGate !== undefined) {
      const gate = await deps.checkRoundGate();
      if (turnStopped(deps)) {
        return await stoppedTurn(deps, secrets);
      }
      if (gate !== null && gate.limited) {
        return await failTurn({ reason: gate.reply, text: withNotices });
      }
    }
    let text: string;
    try {
      const last = await requestCompletion({
        ...completionInput,
        timeoutMs: remainingTurnBudgetMs(startedAt, nowMs, deps.caps?.wallClockMs),
        messages: loop.messages,
        ...(maxRounds <= 1 ? { tools } : {}),
      });
      text =
        last.content === null
          ? TRANSIENT_FAILURE_REPLY + loop.notices.join('')
          : last.content + cutShortSuffix(last.finishReason) + loop.notices.join('');
    } catch (error) {
      return await failTurn({ error, text: withNotices });
    }
    if (turnStopped(deps)) {
      return await stoppedTurn(deps, secrets);
    }
    await finishProgressQuietly(deps, secrets, 'done');
    return sendReply(deps, text);
  }

  if (turnStopped(deps)) {
    return await stoppedTurn(deps, secrets);
  }
  await finishProgressQuietly(deps, secrets, 'done');
  return sendReply(deps, loop.text + loop.notices.join(''));
}
