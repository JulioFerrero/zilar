import {
  ApprovalsApiError,
  type ApprovalDecision,
  type ApprovalRule,
  type ApprovalsApi,
  type PublicApproval,
} from '@/lib/approvals-api';
import { Effect } from 'effect';
import { applyDecision } from '@/lib/approval-state';
import { runMobile } from '@/lib/effect/runtime';

export type RowBusy = null | 'approve_once' | 'approve_always' | 'deny';

export interface ScreenRow {
  approval: PublicApproval;
  busy: RowBusy;
  error: string;
}

export type RowsById = Record<string, ScreenRow>;

export interface OwnedScreenRule {
  aiId: string;
  rule: ApprovalRule;
}

export function rowsForList(
  list: PublicApproval[],
  previous: RowsById,
  inFlight: ReadonlySet<string> = new Set(),
): RowsById {
  const next: RowsById = {};
  for (const approval of list) {
    const prior = previous[approval.id];
    next[approval.id] = {
      approval,
      // A reload must not resurrect a stuck `busy`: only a row with a request
      // still in flight keeps it, so a failed decision never wedges the buttons.
      busy: prior !== undefined && inFlight.has(approval.id) ? prior.busy : null,
      error: prior?.error ?? '',
    };
  }
  return next;
}

export function orderedRows(rows: RowsById): ScreenRow[] {
  return Object.values(rows).sort(
    (a, b) => new Date(b.approval.createdAt).getTime() - new Date(a.approval.createdAt).getTime(),
  );
}

export function groupRulesForScreen(
  owned: OwnedScreenRule[],
): { aiId: string; rules: ApprovalRule[] }[] {
  const byAi = new Map<string, ApprovalRule[]>();
  for (const { aiId, rule } of owned) {
    const list = byAi.get(aiId) ?? [];
    list.push(rule);
    byAi.set(aiId, list);
  }
  return [...byAi.entries()].map(([aiId, rules]) => ({ aiId, rules }));
}

export type RulesFanOut = PromiseSettledResult<{ aiId: string; rules: ApprovalRule[] }>;

/**
 * Merges one rules fetch per AI into the owned list. One AI's failure never
 * blanks the others (a failed AI is skipped); `null` means every AI failed, so
 * the caller shows the error state with Retry.
 */
export function mergeRulesFanOut(settled: RulesFanOut[]): OwnedScreenRule[] | null {
  if (settled.length > 0 && settled.every((result) => result.status === 'rejected')) {
    return null;
  }
  return settled.flatMap((result) =>
    result.status === 'fulfilled'
      ? result.value.rules.map((rule) => ({ aiId: result.value.aiId, rule }))
      : [],
  );
}

export type DecideOutcome =
  | { kind: 'decided'; approval: PublicApproval }
  | { kind: 'gone'; message: string }
  | { kind: 'stale'; approval: PublicApproval }
  | { kind: 'error'; message: string };

export function confirmationForDecision(decision: ApprovalDecision): string {
  switch (decision) {
    case 'approve_once':
      return 'Approved once';
    case 'approve_always':
      return 'Approved always';
    case 'deny':
      return 'Denied';
  }
}

/**
 * Sends one decision through the card's `applyDecision`, so the screen shares
 * its 404/409 handling: a `reloaded` row still pending stays as `stale`, an
 * already-decided one drops as `gone`, and any other failure reports a fixed
 * plain message, never the server's raw text.
 */
export function decideScreenRow(
  api: ApprovalsApi,
  approvalId: string,
  decision: ApprovalDecision,
): Promise<DecideOutcome> {
  return runMobile(
    Effect.promise(() => applyDecision(api, approvalId, decision)).pipe(
      Effect.map((outcome): DecideOutcome => {
        if (outcome.kind === 'ready') {
          return { kind: 'decided', approval: outcome.approval };
        }
        if (outcome.kind === 'reloaded') {
          if (outcome.approval !== null && outcome.approval.status === 'pending') {
            return { kind: 'stale', approval: outcome.approval };
          }
          return { kind: 'gone', message: 'That request was already decided or expired.' };
        }
        return { kind: 'error', message: 'Could not send the decision. Try again.' };
      }),
    ),
  );
}

export function revokeFailedMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not revoke the rule.';
}

/**
 * Per-id in-flight guard for decisions: a second tap while the first POST runs
 * returns false, otherwise it claims the id until the caller releases it.
 */
export function claimDecision(inFlight: Set<string>, id: string): boolean {
  if (inFlight.has(id)) {
    return false;
  }
  inFlight.add(id);
  return true;
}

/**
 * Drops a revoked rule from the list; a 404 means it is already gone, so the
 * row drops quietly like a success.
 */
export function revokeFailedOutcome(error: unknown): { dropped: boolean; message: string } {
  if (error instanceof ApprovalsApiError && error.status === 404) {
    return { dropped: true, message: '' };
  }
  return { dropped: false, message: revokeFailedMessage(error) };
}
