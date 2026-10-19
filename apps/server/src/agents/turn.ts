// effect-plain: the shared failure, send and stop helpers stay Promise-shaped over the turn deps.
import type { SendMessageOptions } from '@zilar/xmpp-core';
import type { DmTurnDeps, DmTurnOutcome } from './dm-turn';
import type { GroupTurnDeps } from './group-turn';
import { byteLength } from './log/append';
import { failureLogFields, mapFailureToReply, redactError } from './tool-exec';
import { MODEL_CALL_MAX_MS, TOOL_TURN_WALL_CLOCK_MS } from './tool-loop';

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
