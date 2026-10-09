import { Effect } from 'effect';
import {
  ApprovalsApiError,
  type ApprovalDecision,
  type ApprovalsApi,
  type PublicApproval,
} from './approvals-api';

export type ApprovalCardState =
  | { kind: 'loading' }
  | { kind: 'notDecidable' }
  | { kind: 'error' }
  | { kind: 'ready'; approval: PublicApproval };

export function approvalStatusLabel(approval: PublicApproval): string {
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

// A 404 means the viewer may not decide this request (or it does not exist):
// the card then shows no buttons and no error. Any other failure on the first
// load surfaces the request text with a Retry button.
const loadCardStateEffect = (
  api: ApprovalsApi,
  approvalId: string,
): Effect.Effect<ApprovalCardState> =>
  Effect.tryPromise({ try: () => api.getApproval(approvalId), catch: (error) => error }).pipe(
    Effect.map((approval): ApprovalCardState => ({ kind: 'ready', approval })),
    Effect.catch((error) =>
      Effect.succeed<ApprovalCardState>(
        error instanceof ApprovalsApiError && error.status === 404
          ? { kind: 'notDecidable' }
          : { kind: 'error' },
      ),
    ),
  );

export function loadApprovalCardState(
  api: ApprovalsApi,
  approvalId: string,
): Promise<ApprovalCardState> {
  return Effect.runPromise(loadCardStateEffect(api, approvalId));
}

// The decide flow: success replaces the row; a 409 (race / expired) reloads the
// row so the card shows the latest state; any other error returns the message
// to surface inline. The caller drives `inFlight` itself.
export type DecisionOutcome =
  | { kind: 'ready'; approval: PublicApproval }
  | { kind: 'reloaded'; approval: PublicApproval | null }
  | { kind: 'error'; message: string };

// The reload after a 409 never fails: a row that cannot be read is `null`.
const reloadApprovalEffect = (
  api: ApprovalsApi,
  approvalId: string,
): Effect.Effect<PublicApproval | null> =>
  Effect.tryPromise({ try: () => api.getApproval(approvalId), catch: () => null }).pipe(
    Effect.catch(() => Effect.succeed(null)),
  );

const applyDecisionEffect = (
  api: ApprovalsApi,
  approvalId: string,
  decision: ApprovalDecision,
): Effect.Effect<DecisionOutcome> =>
  Effect.tryPromise({
    try: () => api.decideApproval(approvalId, decision),
    catch: (error) => error,
  }).pipe(
    Effect.map((approval): DecisionOutcome => ({ kind: 'ready', approval })),
    Effect.catch((error): Effect.Effect<DecisionOutcome> => {
      if (
        error instanceof ApprovalsApiError &&
        (error.code === 'not_pending' || error.code === 'expired')
      ) {
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
  api: ApprovalsApi,
  approvalId: string,
  decision: ApprovalDecision,
): Promise<DecisionOutcome> {
  return Effect.runPromise(applyDecisionEffect(api, approvalId, decision));
}
