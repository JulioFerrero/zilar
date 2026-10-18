// effect-plain: summary and announcer helpers, no Effect here
import { errorName } from '../effect/error-utils';
import type { ActionGatewayDependencies } from './gateway';
import { summaryForOutcome } from './announce';
import { stripModelTextCloseTag, truncateModelText } from './registry';

// 500-character cap on `summary`, matching the approval card's bound; longer strings are truncated.
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

// Strips the wrapper's closing tag and truncates at 16 KiB; `undefined` stays absent from the outcome.
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

// A missing announcer is a no-op; a throw only logs the error class name and never changes an outcome.
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
