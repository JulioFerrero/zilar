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

/** A rule with the AI id re-attached: the rule route is per AI (`/ais/:id/…`) but the row carries none. */
export interface OwnedScreenRule {
  aiId: string;
  rule: ApprovalRule;
}

/** One `ScreenRow` per approval, keeping any in-flight decision state. */
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
      // A reload must not resurrect a stuck `busy`: only a row with a
      // request still in flight keeps it, so a failed decision never wedges
      // the buttons after the list refreshes. The inline `error` is kept so
      // a failure stays visible until the next decision attempt.
      busy: prior !== undefined && inFlight.has(approval.id) ? prior.busy : null,
      error: prior?.error ?? '',
    };
  }
  return next;
}

/** Newest first, like the web inbox. */
export function orderedRows(rows: RowsById): ScreenRow[] {
  return Object.values(rows).sort(
    (a, b) => new Date(b.approval.createdAt).getTime() - new Date(a.approval.createdAt).getTime(),
  );
}

/**
 * Groups owned rules per AI for the "Always allowed" section. Pure, so tests
 * pin it without rendering. (Also exported for the Approvals screen.)
 */
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
 * blanks the others: a failed AI (404 or other) is skipped. `null` means
 * every AI failed (with at least one result), so the caller shows the error
 * state with Retry; otherwise the merged successes come back, even when they
 * are empty.
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

/**
 * Decisions for the screen's pending tab: Approve once (`approve_once`),
 * Always (`approve_always`, the standing rule) and Deny (`deny`).
 */
export const SCREEN_DECISIONS: ReadonlyArray<{
  decision: ApprovalDecision;
  label: string;
  busyLabel: string;
}> = [
  { decision: 'approve_once', label: 'Approve once', busyLabel: 'Approving…' },
  { decision: 'approve_always', label: 'Always', busyLabel: 'Allowing…' },
  { decision: 'deny', label: 'Deny', busyLabel: 'Denying…' },
];

export type DecideOutcome =
  | { kind: 'decided'; approval: PublicApproval }
  | { kind: 'gone'; message: string }
  | { kind: 'stale'; approval: PublicApproval }
  | { kind: 'error'; message: string };

/** The short confirmation line shown where a decided row was. */
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
 * Sends one decision through the card's `applyDecision`, so the screen
 * shares its 404/409 handling. A `reloaded` row means the request was
 * decided or expired elsewhere: when the fresh row is still pending the
 * decision did not land, so the row stays in the list with the refreshed
 * state (`stale`); otherwise the row drops from pending with the
 * "already decided" notice (`gone`). Any other failure (offline, 500,
 * 403, …) reports a fixed plain message — never the server's raw text —
 * so the screen can show it inline and let the person retry.
 */
export function decideScreenRow(
  api: ApprovalsApi,
  approvalId: string,
  decision: ApprovalDecision,
): Promise<DecideOutcome> {
  // applyDecision folds every failure into its outcome, so it never rejects.
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
 * Per-id in-flight guard for decisions. A second tap while the first POST
 * is running returns false (the caller does nothing); otherwise it claims
 * the id and returns true. The caller releases the id when the POST
 * settles. Pure over a `Set` so tests pin it without rendering.
 */
export function claimDecision(inFlight: Set<string>, id: string): boolean {
  if (inFlight.has(id)) {
    return false;
  }
  inFlight.add(id);
  return true;
}

/**
 * Drops a revoked rule from the list; a 404 means it is already gone
 * (revoked elsewhere), so the row drops quietly like a success.
 */
export function revokeFailedOutcome(error: unknown): { dropped: boolean; message: string } {
  if (error instanceof ApprovalsApiError && error.status === 404) {
    return { dropped: true, message: '' };
  }
  return { dropped: false, message: revokeFailedMessage(error) };
}
