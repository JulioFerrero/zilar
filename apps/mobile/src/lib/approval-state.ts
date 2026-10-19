import { ApiError } from '@zilar/api-contract';
import type { ApprovalDecision, makeApprovalsApi, PublicApproval } from '@zilar/client-core';
import { Effect } from 'effect';

export type ApprovalCardState =
  | { kind: 'loading' }
  | { kind: 'notDecidable' }
  | { kind: 'error' }
  | { kind: 'ready'; approval: PublicApproval };

// A 404 means the viewer may not decide this request (or it does not exist): no buttons, no error. Any other first-load failure shows the unavailable sentence.
const loadCardStateEffect = (
  api: ReturnType<typeof makeApprovalsApi>,
  approvalId: string,
): Effect.Effect<ApprovalCardState> =>
  Effect.tryPromise({ try: () => api.getApproval(approvalId), catch: (error) => error }).pipe(
    Effect.map((approval): ApprovalCardState => ({ kind: 'ready', approval })),
    Effect.catch((error) =>
      Effect.succeed<ApprovalCardState>(
        error instanceof ApiError && error.status === 404
          ? { kind: 'notDecidable' }
          : { kind: 'error' },
      ),
    ),
  );

export function loadApprovalCardState(
  api: ReturnType<typeof makeApprovalsApi>,
  approvalId: string,
): Promise<ApprovalCardState> {
  return Effect.runPromise(loadCardStateEffect(api, approvalId));
}

// Success replaces the row; a 409 (race / expired) reloads it so the card shows the latest state; any other error returns the inline message.
export type DecisionOutcome =
  | { kind: 'ready'; approval: PublicApproval }
  | { kind: 'reloaded'; approval: PublicApproval | null }
  | { kind: 'error'; message: string };

// The reload after a 409 never fails: a row that cannot be read is `null`.
const reloadApprovalEffect = (
  api: ReturnType<typeof makeApprovalsApi>,
  approvalId: string,
): Effect.Effect<PublicApproval | null> =>
  Effect.tryPromise({ try: () => api.getApproval(approvalId), catch: () => null }).pipe(
    Effect.catch(() => Effect.succeed(null)),
  );

const applyDecisionEffect = (
  api: ReturnType<typeof makeApprovalsApi>,
  approvalId: string,
  decision: ApprovalDecision,
): Effect.Effect<DecisionOutcome> =>
  Effect.tryPromise({
    try: () => api.decideApproval(approvalId, decision),
    catch: (error) => error,
  }).pipe(
    Effect.map((approval): DecisionOutcome => ({ kind: 'ready', approval })),
    Effect.catch((error): Effect.Effect<DecisionOutcome> => {
      if (error instanceof ApiError && (error.code === 'not_pending' || error.code === 'expired')) {
        return reloadApprovalEffect(api, approvalId).pipe(
          Effect.map((refreshed): DecisionOutcome => ({ kind: 'reloaded', approval: refreshed })),
        );
      }
      return Effect.succeed<DecisionOutcome>({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not send the decision',
      });
    }),
  );

export function applyDecision(
  api: ReturnType<typeof makeApprovalsApi>,
  approvalId: string,
  decision: ApprovalDecision,
): Promise<DecisionOutcome> {
  return Effect.runPromise(applyDecisionEffect(api, approvalId, decision));
}
