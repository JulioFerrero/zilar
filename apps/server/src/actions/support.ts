// effect-plain: moved unchanged from apps/server/src/actions/gateway.ts (size split)
import { errorName } from '../effect/error-utils';
import type { ActionGatewayDependencies } from './gateway';
import { summaryForOutcome } from './announce';
import { stripModelTextCloseTag, truncateModelText } from './registry';

// 500-character cap on the adapter's `summary`, matching the approval card's
// bound. Over-long strings are truncated rather than rejected so the
// caller still gets a usable summary.
export const RESULT_SUMMARY_MAX = 500;

export function truncateText(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return value.slice(0, max);
}

export function truncateSummary(value: string): string {
  return truncateText(value, RESULT_SUMMARY_MAX);
}

// Sanitises an adapter's `modelText` for the `executed` outcome: stripped
// of the wrapper's closing tag, truncated at 16 KiB. `undefined` (the
// adapter returned none) stays `undefined` so the outcome carries no key.
// Never called for `failed` outcomes — a throw has no `modelText`, and a
// post-approval `execute` return is not forwarded to any model.
export function sanitiseModelText(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return truncateModelText(stripModelTextCloseTag(value));
}

export function safeStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export { errorName };

// Calls every entry in `calls` on the optional announcer. A missing announcer
// is a no-op; a throw only logs the error class name. The gateway never lets
// an announcement failure change an outcome, a row or an audit entry.
export async function safeAnnounce(
  deps: ActionGatewayDependencies,
  calls: {
    approvalRequested?: {
      aiId: string;
      groupId: string | null;
      topicId?: string;
      approvalId: string;
    };
    outcome?: {
      aiId: string;
      groupId: string | null;
      topicId?: string;
      status: 'executed' | 'failed' | 'cancelled';
      summary: string | null;
    };
  },
): Promise<void> {
  if (deps.announce === undefined) {
    return;
  }
  try {
    if (calls.approvalRequested !== undefined) {
      await deps.announce.approvalRequested(calls.approvalRequested);
    }
    if (calls.outcome !== undefined) {
      await deps.announce.outcome({
        ...calls.outcome,
        summary: summaryForOutcome(calls.outcome.status, calls.outcome.summary),
      });
    }
  } catch (error) {
    const action =
      calls.outcome !== undefined ? `action.${calls.outcome.status}` : 'action.requested';
    deps.logger.warn(
      {
        err: errorName(error),
        action: calls.outcome?.status ?? 'requested',
        aiId: calls.outcome?.aiId ?? calls.approvalRequested?.aiId,
      },
      `announcer failed for ${action}; carrying on`,
    );
  }
}
