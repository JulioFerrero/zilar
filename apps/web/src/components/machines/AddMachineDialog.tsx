import { useState } from 'react';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { Check, Copy } from 'lucide-react';
import { ApiError, createPairingCode } from '@/lib/api';
import { copyText } from '@/lib/clipboard';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { machineErrorMessage } from './errors';
import { FieldError } from '@/components/ais/AiPageShell';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

type DialogStatus = 'loading' | 'ready' | 'expired' | 'error';

const EXPIRED_ANNOUNCE = 'Code expired';
const COUNTDOWN_TICK_MS = 1000;
const COPIED_MS = 1500;

/**
 * The "Add machine" dialog: mints a fresh pairing code, shows it big in Geist
 * Mono with a copy key, a live countdown, and the `zilar-runner pair <CODE>`
 * command. The desktop runner is not published yet, so the line below the
 * command says so honestly.
 */
export function AddMachineDialog({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);
  const [pairingState, newPairing] = useQuery(
    () =>
      fromApi(() => createPairingCode()).pipe(
        Effect.tap((next) =>
          Effect.sync(() => setRemainingMs(new Date(next.expiresAt).getTime() - Date.now())),
        ),
      ),
    [],
  );
  const pairing =
    AsyncResult.isSuccess(pairingState) && !isWaiting(pairingState) ? pairingState.value : null;

  // The countdown is a run per code: it ends at expiry, and a new code, a
  // close or an unmount interrupts it.
  const expiresAt = pairing?.expiresAt;
  const [countdownState] = useQuery(
    () =>
      expiresAt === undefined
        ? Effect.void
        : countDown(new Date(expiresAt).getTime(), setRemainingMs),
    [expiresAt],
  );
  const expired = pairing !== null && AsyncResult.isSuccess(countdownState);
  const failed = !isWaiting(pairingState) && AsyncResult.isFailure(pairingState);
  const status: DialogStatus = failed
    ? 'error'
    : pairing === null
      ? 'loading'
      : expired
        ? 'expired'
        : 'ready';
  const error = failed
    ? failureText(failureOf(pairingState), 'Could not create a pairing code.')
    : '';

  // A second click restarts the copy and the "Copied" flash, as before.
  const [, copy] = useAction(
    (code: string) =>
      Effect.promise(() => copyText(code)).pipe(
        Effect.andThen(Effect.sync(() => setCopied(true))),
        Effect.andThen(Effect.sleep(COPIED_MS)),
        Effect.andThen(Effect.sync(() => setCopied(false))),
      ),
    { mode: 'replace' },
  );

  const copyCode = (): void => {
    if (pairing !== null) {
      copy(pairing.code);
    }
  };

  const refresh = (): void => {
    setCopied(false);
    newPairing();
  };

  const actions =
    status === 'error' ? (
      <>
        <Button type="button" variant="ghost" size="lg" onClick={onClose}>
          Close
        </Button>
        <Button type="button" onClick={refresh} size="lg">
          Try again
        </Button>
      </>
    ) : (status === 'ready' || status === 'expired') && pairing !== null ? (
      <>
        {status === 'expired' ? (
          <Button type="button" onClick={refresh} size="lg">
            New code
          </Button>
        ) : null}
        <Button type="button" onClick={onClose} size="lg">
          Done
        </Button>
      </>
    ) : undefined;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add machine"
      description="Pair a new computer where your AIs can work."
      size="sm"
      {...(actions === undefined ? {} : { actions })}
    >
      {status === 'loading' && (
        <p className="mt-4 text-[14px] text-muted-foreground">Creating code…</p>
      )}

      {status === 'error' && <FieldError>{error}</FieldError>}

      {(status === 'ready' || status === 'expired') && pairing !== null && (
        <>
          <div className="mt-4 rounded-xl border border-divider bg-well">
            <p
              aria-live="off"
              className="px-4 py-3 text-center font-mono text-[28px] font-semibold tracking-[0.1em]"
            >
              {pairing.code}
            </p>
            <div className="flex items-center justify-between gap-2 border-t border-divider px-3 py-2">
              <p
                role="timer"
                aria-live="off"
                className={cn(
                  'font-mono text-[12px]',
                  status === 'expired' ? 'text-danger' : 'text-muted-foreground',
                )}
              >
                <span aria-hidden="true">
                  {status === 'expired'
                    ? 'Code expired'
                    : `Expires in ${formatRemaining(remainingMs)}`}
                </span>
              </p>
              <Button
                type="button"
                aria-label="Copy pairing code"
                title="Copy pairing code"
                disabled={status === 'expired'}
                onClick={copyCode}
                size="sm"
              >
                {copied ? (
                  <Check className="size-4" aria-hidden="true" />
                ) : (
                  <Copy className="size-4" aria-hidden="true" />
                )}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>

          <p className="mt-3 text-[14px]">
            On the machine, download the runner app, then run{' '}
            <span className="font-mono text-[13px] whitespace-nowrap">
              zilar-runner pair {pairing.code}
            </span>
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            The desktop runner is not published yet — this code is ready for when it is.
          </p>

          {/* Visually hidden so AT users hear the expiry once. */}
          <p role="status" aria-live="polite" className="sr-only">
            {expired ? EXPIRED_ANNOUNCE : ''}
          </p>
        </>
      )}
    </Dialog>
  );
}

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Waits one tick, then reports the time left; a tick at or past expiry reports
 * zero and ends the run, which is what turns the dialog to "expired".
 */
const countDown = Effect.fnUntraced(function* (
  expiresAt: number,
  onTick: (remainingMs: number) => void,
) {
  for (;;) {
    yield* Effect.sleep(COUNTDOWN_TICK_MS);
    const left = expiresAt - Date.now();
    if (left <= 0) {
      yield* Effect.sync(() => onTick(0));
      return;
    }
    yield* Effect.sync(() => onTick(left));
  }
});

/**
 * The text machineErrorMessage gives for an API answer. fromApi keeps an
 * ApiError's code, status and message; any other throw became the generic
 * unknown_error, which shows this component's fallback sentence instead.
 */
function failureText(failure: ApiFailure | undefined, fallback: string): string {
  if (failure === undefined || failure.code === 'unknown_error') {
    return fallback;
  }
  return machineErrorMessage(
    new ApiError(failure.status, failure.code, failure.message, failure.detail),
    fallback,
  );
}
