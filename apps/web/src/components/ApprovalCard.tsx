import { Effect, Schedule } from 'effect';
import { useCallback, useEffect, useRef, useState } from 'react';
import { approvalSentBy, fromApi, type ApiFailure } from '@zilar/client-core';
import { routineCardTitle } from '@zilar/chat-core';
import type { ApprovalRequest } from '@zilar/protocol';
import { Check, Clock, Repeat, X } from 'lucide-react';
import {
  decideApproval,
  getApproval,
  type ApprovalDecision,
  type ApprovalStatus,
  type PublicApproval,
} from '@/lib/api';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ais/AiPageShell';

export function ApprovalCard({
  request,
  senderId,
  topicName,
}: {
  request: ApprovalRequest;
  /** The message sender; the record's `aiId` must belong to it. */
  senderId: string;
  topicName?: string;
}) {
  const { state, apply } = useApprovalPolling(request);
  const [inFlight, setInFlight] = useState<null | 'approve' | 'deny' | 'always'>(null);
  const [confirmingAlways, setConfirmingAlways] = useState(false);
  const [alwaysBlocked, setAlwaysBlocked] = useState(false);

  const refreshAfterStale = () =>
    fromApi(() => getApproval(request.id)).pipe(
      Effect.tap((refreshed) => Effect.sync(() => apply({ kind: 'ready', approval: refreshed }))),
      Effect.catchTag('ApiFailure', () => Effect.void),
    );
  const [decisionState, decide, decisionControls] = useAction((decision: ApprovalDecision) =>
    fromApi(() => decideApproval(request.id, decision)).pipe(
      Effect.tap((approval) => Effect.sync(() => apply({ kind: 'ready', approval }))),
      Effect.catchIf(isStaleDecision, refreshAfterStale),
      // Lost rights: a standing rule is not offered, only the one-time buttons.
      Effect.tapError((failure) =>
        Effect.sync(() => {
          if (isAlwaysRefusal(failure)) {
            setConfirmingAlways(false);
            setAlwaysBlocked(true);
          }
        }),
      ),
      Effect.ensuring(Effect.sync(() => setInFlight(null))),
    ),
  );

  const startDecision = (decision: ApprovalDecision): void => {
    setInFlight(
      decision === 'deny' ? 'deny' : decision === 'approve_always' ? 'always' : 'approve',
    );
    decide(decision);
  };

  // Summary, action and AI come from the server's record, never the message.
  if (state.kind !== 'ready') {
    return (
      <div className="bubble-in flex min-w-[260px] flex-col gap-4 rounded-[12px] p-4">
        {state.kind === 'loading' ? (
          <div
            className="h-7 w-32 rounded-md bg-surface-raised"
            aria-label="Loading approval"
            aria-hidden="true"
          />
        ) : (
          <span className="text-[14px] text-muted-foreground">This request is not available</span>
        )}
      </div>
    );
  }
  const approval = state.approval;
  const pending = approval.status === 'pending' ? approval : null;
  const routine = routineCardTitle(approval.action, approval.summary);
  // A forged message can name a real approval but not decide it: the server's
  // `aiId` must belong to the sender.
  const senderMatches = approvalSentBy(approval.aiId, senderId);

  // A past-due `pending` row already reads `expired`; eligibility also needs
  // the server's flag.
  const showAlways = pending !== null && pending.alwaysEligible && !alwaysBlocked && senderMatches;
  const busy = inFlight !== null;
  const failure = isWaiting(decisionState) ? undefined : failureOf(decisionState);
  const actionError = failure === undefined ? '' : decisionMessage(failure);

  if (pending === null) {
    return (
      <div className="bubble-in flex min-w-[260px] items-center gap-2 rounded-[12px] px-3.5 py-2">
        <DecidedIcon status={approval.status} />
        {routine === null ? (
          <span className="text-[14px] break-words text-muted-foreground">{approval.summary}</span>
        ) : (
          <>
            <span className="min-w-0 flex-1 text-[14px] break-words text-muted-foreground">
              {routine.title}
            </span>
            <span className="shrink-0 font-mono text-[12px] text-muted-foreground">
              {routine.schedule}
            </span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="bubble-in flex min-w-[260px] flex-col gap-4 rounded-[12px] p-4">
      {pending !== null ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] text-muted-foreground">
            {pending.aiName === '' ? 'Asks' : `${pending.aiName} asks`}
          </span>
          {routine === null ? (
            <span className="text-[16px] leading-[22px] font-semibold break-words">
              {approval.summary}
            </span>
          ) : (
            <div className="flex items-center gap-2">
              <Repeat
                className="size-[15px] shrink-0 text-muted-foreground"
                role="img"
                aria-label="Repeats"
              />
              <span className="min-w-0 flex-1 text-[16px] leading-[22px] font-semibold break-words">
                {routine.title}
              </span>
              <span className="shrink-0 font-mono text-[12px] text-muted-foreground">
                {routine.schedule}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-[16px] leading-[22px] font-semibold break-words">
            {approval.summary}
          </span>
        </div>
      )}

      {pending !== null && (
        <div className="flex flex-col gap-2">
          {confirmingAlways && showAlways ? (
            <div className="flex flex-col gap-2">
              <p className="text-[12px] leading-4 text-muted-foreground">
                {topicName !== undefined
                  ? `Always run ${pending.action} without asking, in “${topicName}” only.`
                  : pending.groupId === null
                    ? `Always run ${pending.action} without asking, in this chat only.`
                    : `Always run ${pending.action} without asking, in this group only.`}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="lg"
                  disabled={busy || !senderMatches}
                  onClick={() => startDecision('approve_always')}
                >
                  {inFlight === 'always' ? 'Allowing…' : 'Confirm'}
                </Button>
                <Button
                  type="button"
                  size="lg"
                  variant="outline"
                  disabled={busy || !senderMatches}
                  onClick={() => {
                    setConfirmingAlways(false);
                    decisionControls.reset();
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {showAlways && (
                <Button
                  type="button"
                  size="lg"
                  variant="ghost"
                  className="px-1 text-[13px] font-medium text-muted-foreground"
                  disabled={busy || !senderMatches}
                  onClick={() => {
                    setConfirmingAlways(true);
                    decisionControls.reset();
                  }}
                >
                  Always allow
                </Button>
              )}
              <span className="flex-1" />
              <Button
                type="button"
                size="lg"
                variant="outline"
                disabled={busy || !senderMatches}
                onClick={() => startDecision('deny')}
              >
                {inFlight === 'deny' ? 'Denying…' : 'Deny'}
              </Button>
              <Button
                type="button"
                size="lg"
                disabled={busy || !senderMatches}
                onClick={() => startDecision('approve_once')}
              >
                {inFlight === 'approve' ? 'Approving…' : 'Approve'}
              </Button>
            </div>
          )}
          {actionError !== '' && <FieldError>{actionError}</FieldError>}
        </div>
      )}
    </div>
  );
}

function DecidedIcon({ status }: { status: ApprovalStatus }) {
  if (status === 'denied') {
    return <X className="size-[15px] shrink-0 text-danger" role="img" aria-label="Denied" />;
  }
  if (status === 'expired') {
    return (
      <Clock
        className="size-[15px] shrink-0 text-muted-foreground"
        role="img"
        aria-label="Expired"
      />
    );
  }
  return <Check className="size-[15px] shrink-0 text-online" role="img" aria-label="Approved" />;
}

function isStaleDecision(failure: ApiFailure): boolean {
  return failure.code === 'not_pending' || failure.code === 'expired';
}

function isAlwaysRefusal(failure: ApiFailure): boolean {
  return failure.code === 'always_not_allowed' || failure.code === 'always_requires_admin';
}

function decisionMessage(failure: ApiFailure): string {
  if (failure.code === 'always_not_allowed') {
    return 'This action can only be approved one time.';
  }
  if (failure.code === 'always_requires_admin') {
    return 'Only a group admin can always allow an action here.';
  }
  return failure.code === 'unknown_error' ? 'Could not send the decision' : failure.message;
}

type ApprovalPollingState =
  | { kind: 'loading' }
  | { kind: 'notDecidable' }
  | { kind: 'error' }
  | { kind: 'ready'; approval: PublicApproval };

/** The poll cadence while the card is open and the tab is visible. */
const APPROVAL_POLL_INTERVAL_MS = 10_000;

const defaultVisibility = {
  isVisible: () =>
    typeof document === 'undefined' ? true : document.visibilityState === 'visible',
  subscribe: (onVisible: () => void) => {
    if (typeof document === 'undefined') {
      return () => {};
    }
    const handler = (): void => {
      if (document.visibilityState === 'visible') {
        onVisible();
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  },
};

const defaultNow = (): number => Date.now();

// Two ready states are the same when the id, the status and the decidedAt have not changed;
// the other fields can shift without changing what the card shows.
function sameReady(left: ApprovalPollingState, right: ApprovalPollingState): boolean {
  if (left.kind !== 'ready' || right.kind !== 'ready') {
    return false;
  }
  return (
    left.approval.id === right.approval.id &&
    left.approval.status === right.approval.status &&
    left.approval.decidedAt === right.approval.decidedAt
  );
}

/** Polls request.id while it is pending, the page is visible and it has not expired. Stops on
 * a non-pending status, a 404 (the viewer cannot decide), unmount, an id change and expiry;
 * a failed poll keeps the last good state. The effect never calls setState synchronously. */
function useApprovalPolling(request: ApprovalRequest) {
  const visibility = defaultVisibility;
  const now = defaultNow;

  const [state, setState] = useState<ApprovalPollingState>({ kind: 'loading' });
  // The cell the poll reads; apply writes it too, so an optimistic update short-circuits polls.
  const latestRef = useRef<ApprovalPollingState>({ kind: 'loading' });

  const apply = useCallback((next: ApprovalPollingState): void => {
    latestRef.current = next;
    setState(next);
  }, []);

  // Reset during render (the repo's lint forbids setState in an effect body), comparing the
  // previous key; the polling ref resets inside the effect to stay out of oxlint's refs path.
  const key = request.id;
  const [lastKey, setLastKey] = useState<string>(key);
  if (lastKey !== key) {
    setLastKey(key);
    setState({ kind: 'loading' });
  }

  // The timed loop and the visibility read are separate runs, so a focus never restarts the loop.
  const [, startLoop, loopControls] = useAction<Effect.Effect<unknown>, unknown, never>(
    (effect) => effect,
    { mode: 'replace' },
  );
  const [, readNow, readControls] = useAction<Effect.Effect<unknown>, unknown, never>(
    (effect) => effect,
    { mode: 'replace' },
  );

  useEffect(() => {
    // The id or the reset key changed: drop the cached outcome and start fresh.
    latestRef.current = { kind: 'loading' };

    // One read that checks the latest state when it runs, so each tick sees the previous one.
    const readOnce = (): Effect.Effect<void> =>
      Effect.suspend(() => {
        const prior = latestRef.current;
        if (prior.kind === 'notDecidable') {
          return Effect.void;
        }
        if (prior.kind === 'ready' && prior.approval.status !== 'pending') {
          return Effect.void;
        }
        const requestExpiresAt = new Date(request.expires_at).getTime();
        const expired = now() >= requestExpiresAt;
        // An expired request that was never ready gets one final read; otherwise it is a no-op.
        if (expired && prior.kind !== 'ready' && prior.kind !== 'loading') {
          return Effect.void;
        }
        if (!visibility.isVisible()) {
          return Effect.void;
        }
        return fromApi(() => getApproval(request.id)).pipe(
          Effect.matchEffect({
            onSuccess: (approval) => {
              const next: ApprovalPollingState = { kind: 'ready', approval };
              latestRef.current = next;
              return sameReady(prior, next) ? Effect.void : Effect.sync(() => setState(next));
            },
            onFailure: (failure) => {
              // A 404 stops polling; any other failure keeps the last good state, so a hiccup
              // never flips a decided card into an error.
              if (failure.status === 404) {
                const next: ApprovalPollingState = { kind: 'notDecidable' };
                latestRef.current = next;
                return Effect.sync(() => setState(next));
              }
              if (latestRef.current.kind === 'ready') {
                return Effect.void;
              }
              // No good state yet: surface the error so the card can offer Retry.
              const next: ApprovalPollingState = { kind: 'error' };
              latestRef.current = next;
              return prior.kind === 'error' ? Effect.void : Effect.sync(() => setState(next));
            },
          }),
        );
      });

    // The first read runs right away, then one per interval while the tab is visible.
    startLoop(Effect.repeat(readOnce(), Schedule.fixed(APPROVAL_POLL_INTERVAL_MS)));

    // When the tab becomes visible again, read once so a phone-side decision shows up.
    const unsubscribeVisibility = visibility.subscribe(() => {
      readNow(readOnce());
    });

    return () => {
      loopControls.interrupt();
      readControls.interrupt();
      unsubscribeVisibility();
    };
  }, [
    key,
    request.id,
    request.expires_at,
    visibility,
    now,
    startLoop,
    readNow,
    loopControls,
    readControls,
  ]);

  return { state, apply };
}
