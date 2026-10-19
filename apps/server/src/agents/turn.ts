// effect-plain: the shared failure, send and stop helpers stay Promise-shaped over the turn deps.
import type { SendMessageOptions } from '@zilar/xmpp-core';
import type { ChatToolDefinition } from '../ai/model-client';
import type { DmTurnDeps, DmTurnOutcome } from './dm-turn';
import type { GroupTurnDeps } from './group-turn';
import { byteLength } from './log/append';
import { cutShortSuffix, TRANSIENT_FAILURE_REPLY } from './replies';
import { actionOfCall, failureLogFields, mapFailureToReply, redactError } from './tool-exec';
import {
  MODEL_CALL_MAX_MS,
  TOOL_TURN_WALL_CLOCK_MS,
  requestCompletion,
  type CompleteChatInput,
  type ExecuteToolCall,
} from './tool-loop';
import { runToolLoop } from './tool-rounds';

export const TOOL_TURN_MIN_CALL_MS = 5_000;

export type TurnDeps = DmTurnDeps | GroupTurnDeps;

export interface TurnFailure {
  /** The thrown error, absent when the loop returned a failure. */
  error?: unknown;
  /** The failure reason; mapped from `error` when one was thrown. */
  reason?: string;
  /** The failure text; a function receives the reason. */
  text: string | ((reason: string) => string);
  send: (text: string) => Promise<unknown>;
  finishProgress?: boolean;
  beforeSend?: (reason: string) => Promise<void>;
}

export function remainingTurnBudgetMs(
  startedAt: number,
  nowMs: () => number,
  wallClockMs: number = TOOL_TURN_WALL_CLOCK_MS,
  floorMs: number = TOOL_TURN_MIN_CALL_MS,
): number {
  return Math.min(MODEL_CALL_MAX_MS, Math.max(floorMs, wallClockMs - (nowMs() - startedAt)));
}

/** True once the turn's abort signal has fired. */
export function turnStopped(deps: TurnDeps): boolean {
  return deps.signal?.aborted === true;
}

export async function finishProgressQuietly(
  deps: TurnDeps,
  secrets: string[],
  state: 'done' | 'failed' | 'stopped',
): Promise<void> {
  if (state === 'stopped') deps.log?.append('status', { stage: 'stopped' });
  try {
    await deps.finishProgress?.(state);
  } catch (error) {
    deps.logger.warn(
      { aiId: deps.aiId, err: redactError(error, secrets) },
      'AI task card could not be finished',
    );
  }
}

/** Closes the card as `stopped` and returns the quiet outcome. */
export async function stoppedTurn(deps: TurnDeps, secrets: string[]): Promise<DmTurnOutcome> {
  await finishProgressQuietly(deps, secrets, 'stopped');
  return { kind: 'stopped', text: '' };
}

export async function sendReply(deps: DmTurnDeps, text: string): Promise<DmTurnOutcome> {
  const secrets = [deps.target.apiKey, ...(deps.secrets ?? [])];
  // The complete text goes out as a draft first, so the last `draft` carries
  // the final text before the XMPP message lands. A hook failure is a turn
  // failure, not a send failure, so it runs before the send's try.
  deps.beforeFinalSend?.(text);
  try {
    await deps.sendMessage(deps.ownerJid, 'chat', text);
  } catch (error) {
    deps.logger.warn(
      { err: redactError(error, secrets), aiId: deps.aiId },
      'AI reply could not be sent',
    );
    return { kind: 'failed', text: '' };
  }
  deps.log?.append('answer', { bytes: byteLength(text) });
  return { kind: 'replied', text };
}

// Sends the text into the room and shapes the outcome. A failure flag is
// carried so the result mirrors the success / failure paths the DM tool
// loop returns (today's `runToolTurn` returns `{ kind: 'failed', text }`
// when the second call throws).
export async function sendGroupReply(
  deps: GroupTurnDeps,
  secrets: string[],
  outgoing: { text: string; opts: SendMessageOptions },
  options: { failure: boolean } = { failure: false },
): Promise<DmTurnOutcome> {
  try {
    await deps.sendMessage(deps.roomJid, 'groupchat', outgoing.text, outgoing.opts);
  } catch (error) {
    deps.logger.warn(
      { err: redactError(error, secrets), aiId: deps.aiId },
      'AI group reply could not be sent',
    );
    return { kind: 'failed', text: '' };
  }
  if (!options.failure) {
    deps.log?.append('answer', { bytes: byteLength(outgoing.text) });
  }
  return options.failure
    ? { kind: 'failed', text: outgoing.text }
    : { kind: 'replied', text: outgoing.text };
}

export async function finishTurnFailure(
  deps: TurnDeps,
  secrets: string[],
  failure: TurnFailure,
): Promise<DmTurnOutcome> {
  if (turnStopped(deps)) return stoppedTurn(deps, secrets);
  const reason =
    failure.error === undefined ? (failure.reason ?? '') : mapFailureToReply(failure.error);
  if (failure.error !== undefined) {
    deps.log?.append('error', failureLogFields(failure.error));
    deps.logger.warn({ ...failureLogFields(failure.error), aiId: deps.aiId }, 'AI reply failed');
  }
  if (failure.finishProgress !== false) await finishProgressQuietly(deps, secrets, 'failed');
  try {
    await failure.beforeSend?.(reason);
  } catch (noticeError) {
    deps.logger.warn(
      { err: redactError(noticeError, secrets), aiId: deps.aiId },
      'AI failure notice failed',
    );
  }
  const text = typeof failure.text === 'function' ? failure.text(reason) : failure.text;
  try {
    await failure.send(text);
  } catch (sendError) {
    deps.logger.warn(
      { err: redactError(sendError, secrets), aiId: deps.aiId },
      'AI failure reply could not be sent',
    );
    return { kind: 'failed', text: '' };
  }
  return { kind: 'failed', text };
}

export interface LoopTurnFailure {
  error?: unknown;
  reason?: string;
}

export interface LoopTurnOptions {
  completionInput: Omit<CompleteChatInput, 'messages'>;
  secrets: string[];
  tools: ChatToolDefinition[];
  executeTool?: ExecuteToolCall;
  /** True when the caller handles a loop that already posted into the room. */
  postedToRoom?: boolean;
  fail: (failure: LoopTurnFailure, notices: string[]) => Promise<DmTurnOutcome>;
  reply: (text: string, fromModel: boolean) => Promise<DmTurnOutcome>;
}

export async function runLoopTurn(
  deps: TurnDeps,
  options: LoopTurnOptions,
): Promise<DmTurnOutcome> {
  const { completionInput, secrets, tools, executeTool, postedToRoom, fail, reply } = options;
  const startedAt = deps.turnStartMs ?? (deps.nowMs ?? Date.now)();
  const nowMs = deps.nowMs ?? Date.now;
  const turnLogger = deps.turnLogger ?? { info: () => undefined };
  const maxRounds = deps.maxRounds ?? 1;
  let loop: Awaited<ReturnType<typeof runToolLoop>>;
  try {
    loop = await runToolLoop({
      aiId: deps.aiId,
      messages: deps.messages,
      tools,
      completionInput,
      maxRounds,
      ...(deps.caps === undefined ? {} : { caps: deps.caps }),
      ...(executeTool === undefined ? {} : { executeTool }),
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
    return await fail({ error }, []);
  }
  if (loop.failure !== null) {
    return await fail({ reason: loop.failure.reply }, loop.notices);
  }
  // A call already posted the answer into the room (a `blocks` card),
  // so the room gets no echo reply. The card still finishes `done`, exactly
  // like a normal reply would.
  if (loop.postedToRoom && postedToRoom === true) {
    if (turnStopped(deps)) return await stoppedTurn(deps, secrets);
    await finishProgressQuietly(deps, secrets, 'done');
    return { kind: 'replied', text: '' };
  }
  if (loop.text === null) {
    // The caps stopped the loop with no text: one last call so the AI must
    // answer in text. The single-round shape offers tools on that
    // call and answers from its text alone; longer turns go tool-free.
    // The gate runs first: a stop or budget trip before the last call sends
    // the gate's fixed reply instead of another model call.
    if (deps.checkRoundGate !== undefined) {
      const gate = await deps.checkRoundGate();
      // A stop that landed while the gate was awaited wins over a budget trip:
      // the turn posts no reply and the card ends `stopped`.
      if (turnStopped(deps)) return await stoppedTurn(deps, secrets);
      if (gate !== null && gate.limited) {
        return await fail({ reason: gate.reply }, loop.notices);
      }
    }
    let text: string;
    let fromModel = false;
    try {
      const last = await requestCompletion({
        ...completionInput,
        timeoutMs: remainingTurnBudgetMs(startedAt, nowMs, deps.caps?.wallClockMs),
        messages: loop.messages,
        ...(maxRounds <= 1 ? { tools } : {}),
      });
      if (last.content === null) {
        text = TRANSIENT_FAILURE_REPLY + loop.notices.join('');
      } else {
        text = last.content + cutShortSuffix(last.finishReason) + loop.notices.join('');
        fromModel = true;
      }
    } catch (error) {
      return await fail({ error }, loop.notices);
    }
    if (turnStopped(deps)) return await stoppedTurn(deps, secrets);
    await finishProgressQuietly(deps, secrets, 'done');
    return await reply(text, fromModel);
  }

  if (turnStopped(deps)) return await stoppedTurn(deps, secrets);
  await finishProgressQuietly(deps, secrets, 'done');
  return await reply(loop.text + loop.notices.join(''), true);
}
