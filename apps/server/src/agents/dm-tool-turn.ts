// effect-plain: the turn adapters stay Promise-shaped over the shared tool loop.
import type { FetchLike } from '../ai/http';
import type { ModelTarget } from '../ai/providers';
import type { ChatUsage } from '../ai/model-client';
import type { DmTurnDeps, DmTurnOutcome } from './dm-turn';
import { cutShortSuffix } from './replies';
import { finishProgressQuietly, stoppedTurn, turnStopped } from './turn-stop';
import { sendReply } from './turn-send';
import { failureLogFields, mapFailureToReply, redactError, actionOfCall } from './tool-exec';
import { TRANSIENT_FAILURE_REPLY, requestCompletion, type ModelRequestMessage } from './tool-loop';
import { runToolLoop } from './tool-rounds';
import { remainingTurnBudgetMs } from './turn-budget';
import type { ChatToolDefinition } from './tools';
import type { TurnLog } from './log/append';

export { runToolLoop } from './tool-rounds';

export async function runToolTurn(
  deps: DmTurnDeps,
  completionInput: {
    target: ModelTarget;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
    secrets?: readonly string[];
    onDelta?: (textSoFar: string) => void;
    onUsage?: (usage: ChatUsage) => void;
    log?: TurnLog;
    signal?: AbortSignal;
  },
  secrets: string[],
  tools: ChatToolDefinition[],
): Promise<DmTurnOutcome> {
  const startedAt = deps.turnStartMs ?? (deps.nowMs ?? Date.now)();
  const nowMs = deps.nowMs ?? Date.now;
  const turnLogger = deps.turnLogger ?? { info: () => undefined };
  const maxRounds = deps.maxRounds ?? 1;
  let loop: {
    text: string | null;
    notices: string[];
    failure: { reply: string } | null;
    rounds: number;
    toolCalls: number;
    messages: ModelRequestMessage[];
  };
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
    if (turnStopped(deps)) {
      return await stoppedTurn(deps, secrets);
    }
    // The loop throws only for an empty first reply or a failed model
    // call: the failure text goes out like any other model failure, with
    // no notices (none were earned yet).
    const failure = mapFailureToReply(error);
    deps.log?.append('error', failureLogFields(error));
    deps.logger.warn({ ...failureLogFields(error), aiId: deps.aiId }, 'AI reply failed');
    await finishProgressQuietly(deps, secrets, 'failed');
    try {
      await deps.sendMessage(deps.ownerJid, 'chat', failure);
    } catch (sendError) {
      deps.logger.warn(
        { err: redactError(sendError, secrets), aiId: deps.aiId },
        'AI failure reply could not be sent',
      );
      return { kind: 'failed', text: '' };
    }
    return { kind: 'failed', text: failure };
  }
  if (loop.failure !== null) {
    if (turnStopped(deps)) {
      return await stoppedTurn(deps, secrets);
    }
    await finishProgressQuietly(deps, secrets, 'failed');
    const text = loop.failure.reply + loop.notices.join('');
    try {
      await deps.sendMessage(deps.ownerJid, 'chat', text);
    } catch (sendError) {
      deps.logger.warn(
        { err: redactError(sendError, secrets), aiId: deps.aiId },
        'AI failure reply could not be sent',
      );
      return { kind: 'failed', text: '' };
    }
    return { kind: 'failed', text };
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
        await finishProgressQuietly(deps, secrets, 'failed');
        const text = gate.reply + loop.notices.join('');
        try {
          await deps.sendMessage(deps.ownerJid, 'chat', text);
        } catch (sendError) {
          deps.logger.warn(
            { err: redactError(sendError, secrets), aiId: deps.aiId },
            'AI failure reply could not be sent',
          );
          return { kind: 'failed', text: '' };
        }
        return { kind: 'failed', text };
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
      if (turnStopped(deps)) {
        return await stoppedTurn(deps, secrets);
      }
      const failure = mapFailureToReply(error);
      deps.log?.append('error', failureLogFields(error));
      deps.logger.warn({ ...failureLogFields(error), aiId: deps.aiId }, 'AI reply failed');
      await finishProgressQuietly(deps, secrets, 'failed');
      const text = failure + loop.notices.join('');
      try {
        await deps.sendMessage(deps.ownerJid, 'chat', text);
      } catch (sendError) {
        deps.logger.warn(
          { err: redactError(sendError, secrets), aiId: deps.aiId },
          'AI failure reply could not be sent',
        );
        return { kind: 'failed', text: '' };
      }
      return { kind: 'failed', text };
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
