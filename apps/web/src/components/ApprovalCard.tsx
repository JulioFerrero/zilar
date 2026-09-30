import { useState } from 'react';
import type { ApprovalRequest } from '@galena/protocol';
import { ShieldAlert } from 'lucide-react';
import {
  ApiError,
  decideApproval,
  getApproval,
  type ApprovalDecision,
  type PublicApproval,
} from '@/lib/api';
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
  const [actionError, setActionError] = useState('');
  // T-0100: the "Always allow here" two-step. The first click arms the
  // inline confirmation; `alwaysBlocked` drops the third button for the
  // rest of this view when the server says the action is not eligible.
  const [confirmingAlways, setConfirmingAlways] = useState(false);
  const [alwaysBlocked, setAlwaysBlocked] = useState(false);

  const retry = (): void => {
    setRetryToken((value) => value + 1);
  };

  async function decide(decision: ApprovalDecision): Promise<void> {
    setActionError('');
    setInFlight(
      decision === 'deny' ? 'deny' : decision === 'approve_always' ? 'always' : 'approve',
    );
    try {
      const approval = await decideApproval(request.id, decision);
      apply({ kind: 'ready', approval });
    } catch (error) {
      if (error instanceof ApiError && (error.code === 'not_pending' || error.code === 'expired')) {
        const refreshed = await getApproval(request.id).catch(() => null);
        if (refreshed !== null) {
          apply({ kind: 'ready', approval: refreshed });
        }
        return;
      }
      // The action lost its eligibility (or never had it): say so in plain
      // words and drop the third button instead of leaving a dead end.
      if (error instanceof ApiError && error.code === 'always_not_allowed') {
        setConfirmingAlways(false);
        setAlwaysBlocked(true);
        setActionError('This action can only be approved one time.');
        return;
      }
      // T-0101: the viewer lost group-admin rights (or never had them) —
      // a standing rule for the group needs an admin. Same pattern as
      // above: drop the third button, keep the one-time buttons.
      if (error instanceof ApiError && error.code === 'always_requires_admin') {
        setConfirmingAlways(false);
        setAlwaysBlocked(true);
        setActionError('Only a group admin can always allow an action here.');
        return;
      }
      setActionError(error instanceof Error ? error.message : 'Could not send the decision');
    } finally {
      setInFlight(null);
    }
  }

  const approval = state.kind === 'ready' ? state.approval : null;
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
                  onClick={() => {
                    void decide('approve_always');
                  }}
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
                    setActionError('');
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
                onClick={() => {
                  void decide('approve_once');
                }}
              >
                {inFlight === 'approve' ? 'Approving…' : 'Approve'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="px-3"
                disabled={busy}
                onClick={() => {
                  void decide('deny');
                }}
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
                    setActionError('');
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
