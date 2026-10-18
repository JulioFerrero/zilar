import { Effect } from 'effect';
import { useState } from 'react';
import { approvalSentBy } from '@zilar/client-core';
import { routineCardTitle } from '@zilar/chat-core';
import type { ApprovalRequest } from '@zilar/protocol';
import { Check, Clock, Repeat, X } from 'lucide-react';
import { decideApproval, getApproval, type ApprovalDecision, type ApprovalStatus } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useApprovalPolling } from '@/lib/useApprovalPolling';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ais/AiPageShell';

export function ApprovalCard({
  request,
  senderId,
  topicName,
}: {
  request: ApprovalRequest;
  /** T-2001: the message sender; the record's `aiId` must belong to it. */
  senderId: string;
  /** T-0111: the topic the card lives in; the confirm copy names it. */
  topicName?: string;
}) {
  // The polling hook owns the card's read-model state. A non-pending outcome,
  // a 404, an id change, and an unmount all stop further reads; a failed poll
  // keeps the last good state. `apply` lets the card push an optimistic state
  // after a decision so the buttons drop at once.
  const { state, apply } = useApprovalPolling(request);
  const [inFlight, setInFlight] = useState<null | 'approve' | 'deny' | 'always'>(null);
  // T-0100: the "Always allow" two-step. The first click arms the inline
  // confirmation; `alwaysBlocked` drops the button for the rest of this view
  // when the server says the action is not eligible.
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

  const startDecision = (decision: ApprovalDecision): void => {
    setInFlight(
      decision === 'deny' ? 'deny' : decision === 'approve_always' ? 'always' : 'approve',
    );
    decide(decision);
  };

  // T-2001: the summary, action and AI come from the server's record, never
  // from the message. Without a loaded record there is no card to act on: the
  // loading state shows a placeholder, and a failed or missing read shows the
  // fixed sentence with no buttons.
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
  // T-1723: a routine card's summary holds the title and the schedule; draw
  // them apart, null for every other card.
  const routine = routineCardTitle(approval.action, approval.summary);
  // T-2001: a forged card can name a real approval but must not decide it with
  // its own buttons. The server's `aiId` has to belong to the message sender.
  const senderMatches = approvalSentBy(approval.aiId, senderId);

  // The server turns a past-due `pending` row into `expired` in its read model
  // (see `toPublicApproval`), so a `pending` status is already "pending and
  // not expired" from the user's perspective. The third button needs the
  // server's eligibility flag too: the polling state is the decidable read
  // model, so a non-decider never gets this far (the hook reports
  // `notDecidable` for them).
  const showAlways = pending !== null && pending.alwaysEligible && !alwaysBlocked && senderMatches;
  const busy = inFlight !== null;
  // The last failure, hidden while a new decision runs.
  const failure = isWaiting(decisionState) ? undefined : failureOf(decisionState);
  const actionError = failure === undefined ? '' : decisionMessage(failure);

  // A decided request is one compact line: an icon and the summary, muted.
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

/** The decided status as one icon: green check, red cross, grey clock. */
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
