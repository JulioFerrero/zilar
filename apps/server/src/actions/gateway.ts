import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import type { ActionAnnouncer } from './announce';
import { runRequest } from './decisions';
import type { PolicyDenialReason } from './policy';
import { runOnApprovalDecided } from './queries';
import type { ActionContextLogger, ActionRegistry } from './registry';
import { runRecoverStuck } from './recovery';

export type { ActionAnnouncer };

// Policy decisions never throw: `executed` carries a summary and optional `modelText` (never stored, audited or announced), `denied` a reason, and `failed` no detail so adapter error text cannot leak.
export type RequestOutcome =
  | { status: 'executed'; summary: string; modelText?: string; posted?: boolean }
  | { status: 'failed' }
  | { status: 'denied'; reason: PolicyDenialReason }
  | { status: 'pending_approval'; approvalId: string };

export interface ActionGatewayLogger extends ActionContextLogger {
  error: (fields: Record<string, unknown>, message: string) => void;
}

// A recorder failure is swallowed: the audit log is best-effort and must not change what the policy answers.
export interface ActionGatewayDependencies {
  db: ServerDatabase;
  adapters: ActionRegistry;
  audit: AuditRecorder;
  logger: ActionGatewayLogger;
  // Optional port that announces tier-2 requests and outcomes; every call is best-effort.
  announce?: ActionAnnouncer;
  now?: () => Date;
}

export interface ActionGateway {
  request: (params: RequestParams) => Promise<RequestOutcome>;
  onApprovalDecided: (approvalId: string) => Promise<void>;
  recoverStuck: () => Promise<void>;
  listActions: () => Array<{ name: string; description: string; argsExample?: string }>;
}

export interface RequestParams {
  aiId: string;
  groupId?: string;
  // Required with `groupId`; the gateway denies a topic that is not in the group or whose room the AI is not in.
  topicId?: string;
  action: string;
  args: unknown;
  requestedBy: string;
  // A scheduled run has no approver: tier 0/1 unchanged, tier 2 without a rule is denied `needs_approval`.
  unattended?: boolean;
}

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

// Model-facing view: name, description and args example, sorted so the tool definition is stable.
function listActions(
  deps: ActionGatewayDependencies,
): Array<{ name: string; description: string; argsExample?: string }> {
  return Object.values(deps.adapters)
    .map((adapter) => ({
      name: adapter.name,
      description: adapter.description,
      ...(adapter.argsExample === undefined ? {} : { argsExample: adapter.argsExample }),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export { APPROVAL_TTL_MS, MAX_STORED_ARGS_BYTES } from './decisions';
export { STUCK_RUNNING_MS, startRecoveryStuckTimer } from './recovery';
export type { RecoveryStuckHandle, StartRecoveryStuckTimerOptions } from './recovery';
export { RESULT_SUMMARY_MAX } from './support';
