import { Effect } from 'effect';
import { useState } from 'react';
import type { ApprovalRequest } from '@zilar/protocol';
import { ShieldAlert } from 'lucide-react';
import { decideApproval, getApproval, type ApprovalDecision, type PublicApproval } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useApprovalPolling } from '@/lib/useApprovalPolling';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ais/AiPageShell';
import { formatMoney } from '@/lib/format';

function statusLabel(approval: PublicApproval): string {
  switch (approval.status) {
    case 'pending':
      return 'Pending';
    case 'approved_once':
    case 'approved_always':
      return 'Approved';
    case 'denied':
      return 'Denied';
    case 'consumed':
      return 'Already used';
    case 'expired':
      return 'Expired';
  }
}

export function ApprovalCard({
  request,
  topicName,
}: {
  request: ApprovalRequest;
  /** T-0111: the topic the card lives in; the confirm copy names it. */
  topicName?: string;
}) {
  // Bumped on a manual retry to force the polling hook to drop its current
  // state and re-fetch from scratch.
  const [retryToken, setRetryToken] = useState(0);
  // The polling hook owns the card's read-model state. A non-pending outcome,
  // a 404, an id change, and an unmount all stop further reads; a failed poll
  // keeps the last good state. `apply` lets the card push an optimistic state
  // after a decision so the buttons drop at once.
  const { state, apply } = useApprovalPolling(request, { resetKey: retryToken });
  const [inFlight, setInFlight] = useState<null | 'approve' | 'deny' | 'always'>(null);
  // T-0100: the "Always allow here" two-step. The first click arms the
  // inline confirmation; `alwaysBlocked` drops the third button for the
  // rest of this view when the server says the action is not eligible.
  const [confirmingAlways, setConfirmingAlways] = useState(false);
  const [alwaysBlocked, setAlwaysBlocked] = useState(false);

  // A stale answer (already decided or expired) reads the card again, so it
  // shows the server's state instead of an error.
  const refreshAfterStale = () =>
    fromApi(() => getApproval(request.id)).pipe(
      Effect.tap((refreshed) => Effect.sync(() => apply({ kind: 'ready', approval: refreshed }))),
      Effect.catchTag('ApiFailure', () => Effect.void),
    );
  const [decisionState, decide, decisionControls] = useAction((decision: ApprovalDecision) =>
    fromApi(() => decideApproval(request.id, decision)).pipe(
      Effect.tap((approval) => Effect.sync(() => apply({ kind: 'ready', approval }))),
      Effect.catchIf(isStaleDecision, refreshAfterStale),
      // T-0101: the viewer lost the rights a standing rule needs: drop the
      // third button, keep the one-time buttons.
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

  const approval = state.kind === 'ready' ? state.approval : null;
  // T-0141: the approver names ride the list payload (T-0134), so the card
  // reads them from the polling state — no per-card `getTopic` (N+1).
  const approverNames = approval?.approverNames ?? [];

  const retry = (): void => {
    setRetryToken((value) => value + 1);
  };

  const startDecision = (decision: ApprovalDecision): void => {
    setInFlight(
      decision === 'deny' ? 'deny' : decision === 'approve_always' ? 'always' : 'approve',
    );
    decide(decision);
  };

  // The server turns a past-due `pending` row into `expired` in its read model
  // (see `toPublicApproval`), so a `pending` status is already "pending and
  // not expired" from the user's perspective. The third button needs the
  // server's eligibility flag too: the polling state is the decidable read
  // model, so a non-decider never gets this far (the hook reports
  // `notDecidable` for them).
  const isPending = approval !== null && approval.status === 'pending';
  const showAlways =
    isPending && approval.alwaysEligible && !alwaysBlocked && state.kind === 'ready';
  const busy = inFlight !== null;
  // The last failure, hidden while a new decision runs.
  const failure = isWaiting(decisionState) ? undefined : failureOf(decisionState);
  const actionError = failure === undefined ? '' : decisionMessage(failure);

  return (
    <div className="bubble-in min-w-[260px] rounded-[12px] p-2.5">
      <div className="flex items-center gap-2">
        <ShieldAlert className="size-4 shrink-0 text-accent" aria-hidden="true" />
        <span className="text-[14px] font-semibold break-words">{request.action}</span>
      </div>
      <p className="mt-1 text-[13px] leading-5">{request.summary}</p>
      {request.details !== undefined && (
        <p className="mt-1 text-[12px] leading-4 text-muted-foreground">{request.details}</p>
      )}
      {request.worst_case_cost !== undefined && (
        <p className="mt-1 text-[12px] text-muted-foreground">
          Worst case: {formatMoney(request.worst_case_cost)}
        </p>
      )}
      {approverNames.length > 0 && (
        <p className="mt-1 text-[12px] text-muted-foreground">
          Approvers: {approverNames.join(', ')}
        </p>
      )}

      {state.kind === 'loading' && (
        <div
          className="mt-2 h-7 w-32 rounded-md bg-surface-raised"
          aria-label="Loading approval"
          aria-hidden="true"
        />
      )}

      {state.kind === 'notDecidable' && (
        <p className="mt-2 text-[12px] text-muted-foreground">Waiting for a decision</p>
      )}

      {state.kind === 'error' && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-[12px] text-muted-foreground" role="status">
            Could not load the decision state
          </p>
          <div>
            <Button type="button" size="sm" variant="outline" className="px-3" onClick={retry}>
              Retry
            </Button>
          </div>
        </div>
      )}

      {approval !== null && !isPending && (
        <p className="mt-2 text-[12px] text-muted-foreground" role="status">
          {statusLabel(approval)}
        </p>
      )}

      {isPending && approval !== null && (
        <div className="mt-2 flex flex-col gap-2">
          {confirmingAlways && showAlways ? (
            <div className="flex flex-col gap-2">
              <p className="text-[12px] leading-4 text-muted-foreground">
                {topicName !== undefined
                  ? `Always run ${request.action} without asking, in “${topicName}” only.`
                  : approval.groupId === null
                    ? `Always run ${request.action} without asking, in this chat only.`
                    : `Always run ${request.action} without asking, in this group only.`}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="px-3"
                  disabled={busy}
                  onClick={() => startDecision('approve_always')}
                >
                  {inFlight === 'always' ? 'Allowing…' : 'Confirm'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="px-3"
                  disabled={busy}
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
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                className="px-3"
                disabled={busy}
                onClick={() => startDecision('approve_once')}
              >
                {inFlight === 'approve' ? 'Approving…' : 'Approve'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="px-3"
                disabled={busy}
                onClick={() => startDecision('deny')}
              >
                {inFlight === 'deny' ? 'Denying…' : 'Deny'}
              </Button>
              {showAlways && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="px-3"
                  disabled={busy}
                  onClick={() => {
                    setConfirmingAlways(true);
                    decisionControls.reset();
                  }}
                >
                  Always allow here
                </Button>
              )}
            </div>
          )}
          {actionError !== '' && <FieldError>{actionError}</FieldError>}
        </div>
      )}
    </div>
  );
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
