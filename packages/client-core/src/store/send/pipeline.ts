import { Cause, Deferred, Effect } from 'effect';
import type { SendCtx, SendRun } from './context';
import { sendFailureReasonFor } from '../send-failure';

/** A send that neither succeeds nor fails within this long is failed with `timed_out`,
 * so a hung request cannot sit on the clock. */
export const SEND_TIMEOUT_MS = 60_000;

const newRun = (): SendRun => ({ settled: Deferred.makeUnsafe<void>() });

const timeoutKey = (root: string): string => `send-timeout:${root}`;

// One send attempt's deadline: when it passes while the message is still `sending`, the
// send is failed with `timed_out` and its late result ignored. A new attempt replaces the
// previous watcher; the watchers die with the store Scope.
function armSendTimeout(ctx: SendCtx, chatId: string, messageId: string, run: SendRun): void {
  const key = ctx.k.aliasRoot(messageId);
  ctx.sendRuns.set(key, run);
  ctx.rt.forkKeyed(
    timeoutKey(key),
    Deferred.await(run.settled).pipe(
      Effect.timeoutOrElse({
        duration: SEND_TIMEOUT_MS,
        orElse: () =>
          Effect.sync(() => {
            if (ctx.sendRuns.get(key) !== run) {
              return;
            }
            ctx.sendRuns.delete(key);
            ctx.k.markSendFailed(chatId, messageId, 'timed_out');
          }),
      }),
    ),
  );
}

// The pipeline settled this run: drop its watcher without firing, so a late result cannot
// flip the message.
function settleSendTimeout(ctx: SendCtx, messageId: string, run: SendRun): void {
  const key = ctx.k.aliasRoot(messageId);
  if (ctx.sendRuns.get(key) !== run) {
    return;
  }
  Deferred.doneUnsafe(run.settled, Effect.void);
  ctx.sendRuns.delete(key);
}

// Whether `run` is still the current attempt: a retry arms a new run, and the older
// pipeline's late result must ignore itself.
const isCurrentSendRun = (ctx: SendCtx, messageId: string, run: SendRun): boolean =>
  ctx.sendRuns.get(ctx.k.aliasRoot(messageId)) === run;

// Whether the optimistic bubble is still in the store: a cancelled send must stop before
// it puts anything on the wire (and not resurrect it).
const messageAlive = (ctx: SendCtx, chatId: string, localId: string): boolean =>
  ctx.k.listFor(ctx.get(), chatId).some((item) => ctx.k.sameMessage(item.id, localId));

// Drops a message's watcher and run token: its send was cancelled or deleted, so a late
// result must not touch the bubble.
export function disarmSend(ctx: SendCtx, messageId: string): void {
  const root = ctx.k.aliasRoot(messageId);
  if (ctx.sendRuns.has(root)) {
    ctx.rt.cancel(timeoutKey(root));
    ctx.sendRuns.delete(root);
  }
}

const settleFailure = (
  ctx: SendCtx,
  chatId: string,
  localId: string,
  run: SendRun,
  cause: Cause.Cause<unknown>,
  after?: () => void,
): void => {
  if (!isCurrentSendRun(ctx, localId, run)) {
    return;
  }
  settleSendTimeout(ctx, localId, run);
  ctx.k.markSendFailed(chatId, localId, sendFailureReasonFor(Cause.squash(cause), false));
  after?.();
};

export { armSendTimeout, isCurrentSendRun, messageAlive, newRun, settleFailure, settleSendTimeout };
