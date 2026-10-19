// effect-plain: the shared failure tail stays Promise-shaped over the turn deps.
import type { DmTurnOutcome } from './dm-turn';
import type { TurnDeps } from './turn-stop';
import { finishProgressQuietly, stoppedTurn, turnStopped } from './turn-stop';
import { failureLogFields, mapFailureToReply, redactError } from './tool-exec';

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
