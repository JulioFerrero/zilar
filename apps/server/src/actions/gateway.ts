import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import type { ActionAnnouncer } from './announce';
import { runRequest } from './decisions';
import type { PolicyDenialReason } from './policy';
import { runOnApprovalDecided } from './queries';
import type { ActionRegistry } from './registry';
import { runRecoverStuck } from './recovery';

export type { ActionAnnouncer };

// The result of `request`. The gateway never throws for a policy decision;
// it answers one of these four shapes. `executed` carries a `summary` and,
// when the adapter returned one, a `modelText` for the model only (never
// stored, never audited, never announced — see `ActionResult.modelText`);
// `denied` carries a `reason`. `failed` returns nothing: the gateway
// audited the failure, and the caller learns it failed, not why (the
// adapter's error text must never leak).
export type RequestOutcome =
  | { status: 'executed'; summary: string; modelText?: string }
  | { status: 'failed' }
  | { status: 'denied'; reason: PolicyDenialReason }
  | { status: 'pending_approval'; approvalId: string };

// The narrow slice of pino the gateway needs. Real wiring passes the
// server's logger; tests pass a captor that records the `err` field
// without echoing rows or arguments.
export interface ActionGatewayLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
  error: (fields: Record<string, unknown>, message: string) => void;
}

// A simple logger shape that swallows `record` failures. The gateway wraps
// the recorder so a database write error never propagates into the caller's
// `request` — the audit log is best-effort, the gateway's job is to do
// what the policy says.
export interface ActionGatewayDependencies {
  db: ServerDatabase;
  adapters: ActionRegistry;
  audit: AuditRecorder;
  logger: ActionGatewayLogger;
  /**
   * Optional port the gateway uses to announce tier-2 requests and their
   * outcomes into the chat. Absent in tests and the default gateway; present
   * in `index.ts` so a stopped AI posts nothing. Every call is best-effort:
   * the gateway swallows a rejection.
   */
  announce?: ActionAnnouncer;
  now?: () => Date;
}

// The handle returned by `createActionGateway`. `request` is the only
// public surface right now; `onApprovalDecided` is wired into the
// approvals route, and `recoverStuck` runs at startup and on a timer.
// `listActions` is the read-only view the agent gateway uses to build the
// `request_action` tool definition: every registered action's name and
// description, sorted by name so the order is stable for the model.
export interface ActionGateway {
  request: (params: RequestParams) => Promise<RequestOutcome>;
  onApprovalDecided: (approvalId: string) => Promise<void>;
  recoverStuck: () => Promise<void>;
  listActions: () => Array<{ name: string; description: string }>;
}

export interface RequestParams {
  aiId: string;
  groupId?: string;
  /** The topic the request was raised in. Required with `groupId`
   *  (group scope is always a topic; General is a topic too), absent for
   *  personal chats. The gateway denies the request when the topic does
   *  not belong to the group or the AI is not a member of it. */
  topicId?: string;
  action: string;
  args: unknown;
  requestedBy: string;
}

// Re-export the policy reason enum so callers can branch without depending
// on the policy module directly.
export type DeniedReason = PolicyDenialReason;

export function createActionGateway(deps: ActionGatewayDependencies): ActionGateway {
  const now = deps.now ?? (() => new Date());

  return {
    request: (params) => runRequest(deps, params, now),
    onApprovalDecided: (approvalId) => runOnApprovalDecided(deps, approvalId, now),
    recoverStuck: () => runRecoverStuck(deps, now),
    listActions: () => listActions(deps),
  };
}

// The model-facing view of the registry: just name + description, sorted
// by name so the tool definition the AI sees is the same on every turn.
// The full adapter (tier, schema, execute) stays behind the gateway.
function listActions(
  deps: ActionGatewayDependencies,
): Array<{ name: string; description: string }> {
  return Object.values(deps.adapters)
    .map((adapter) => ({ name: adapter.name, description: adapter.description }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export { APPROVAL_TTL_MS, MAX_STORED_ARGS_BYTES } from './decisions';
export { STUCK_RUNNING_MS, startRecoveryStuckTimer } from './recovery';
export type { RecoveryStuckHandle, StartRecoveryStuckTimerOptions } from './recovery';
export { RESULT_SUMMARY_MAX } from './support';
