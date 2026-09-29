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

export function ApprovalCard({ request }: { request: ApprovalRequest }) {
  // Bumped on a manual retry to force the polling hook to drop its current
  // state and re-fetch from scratch.
  const [retryToken, setRetryToken] = useState(0);
  // The polling hook owns the card's read-model state. A non-pending outcome,
  // a 404, an id change, and an unmount all stop further reads; a failed poll
  // keeps the last good state. `apply` lets the card push an optimistic state
  // after a decision so the buttons drop at once.
  const { state, apply } = useApprovalPolling(request, { resetKey: retryToken });
  const [inFlight, setInFlight] = useState<null | 'approve' | 'deny'>(null);
  const [actionError, setActionError] = useState('');

  const retry = (): void => {
    setRetryToken((value) => value + 1);
  };

  async function decide(decision: ApprovalDecision): Promise<void> {
    setActionError('');
    setInFlight(decision === 'deny' ? 'deny' : 'approve');
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
      setActionError(error instanceof Error ? error.message : 'Could not send the decision');
    } finally {
      setInFlight(null);
    }
  }

  const approval = state.kind === 'ready' ? state.approval : null;
  // The server turns a past-due `pending` row into `expired` in its read model
  // (see `toPublicApproval`), so a `pending` status is already "pending and
  // not expired" from the user's perspective.
  const isPending = approval !== null && approval.status === 'pending';
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

      {isPending && (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex gap-2">
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
          </div>
          {actionError !== '' && <FieldError>{actionError}</FieldError>}
        </div>
      )}
    </div>
  );
}
