// The AI health rules behind the My AIs row: the dot's state, the one reason
// line and the fix it offers (T-1510 on web, T-1517 on the phone). One pure
// helper so both apps read the same words.

// The reason words for a failed turn, by `kind` (apps/server/src/agents/failure-class.ts).
const FAILURE_REASONS: Record<string, string> = {
  key_rejected: 'Key rejected',
  model_not_found: 'Model not found',
  rate_limited: 'Rate limited',
  budget: 'Provider budget reached',
  context_too_long: 'Too much context',
  timeout: 'Timed out',
};

const UNKNOWN_REASON = 'Last reply failed';

/** The health dot's state; first match wins (stopped, failing, paused, working). */
export type AiHealthState = 'working' | 'failing' | 'paused' | 'stopped';

/** The fix a failing AI offers: replace its key, or change its model. */
export type AiFix = 'replace_key' | 'change_model';

export interface AiHealth {
  state: AiHealthState;
  /** The reason words, only when the AI is failing. */
  reason?: string;
  /** The fix, only for a rejected key or a model the provider does not know. */
  fix?: AiFix;
}

export interface AiHealthInput {
  status: string;
  limits: { perDayUsd: number | null };
  usage?: { todayUsd: number } | null;
  lastFailure?: { kind: string } | null;
}

/** `$2` -> `$2.00`. Server amounts are plain USD numbers. */
export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** Today's spend as a fraction of the daily limit (0..1), or null when either is missing. */
export function spendFraction(ai: AiHealthInput): number | null {
  const limit = ai.limits.perDayUsd;
  const usage = ai.usage ?? null;
  if (limit === null || usage === null) {
    return null;
  }
  return Math.min(1, usage.todayUsd / limit);
}

/**
 * The health of one AI, first match wins: a status that is not `active` is
 * stopped; a logged failure fails with its reason and, for the two the owner
 * can fix here, its fix; today's spend at the daily limit is paused; otherwise
 * it works.
 */
export function aiHealth(ai: AiHealthInput): AiHealth {
  if (ai.status !== 'active') {
    return { state: 'stopped' };
  }
  const lastFailure = ai.lastFailure ?? null;
  if (lastFailure !== null) {
    const reason = FAILURE_REASONS[lastFailure.kind] ?? UNKNOWN_REASON;
    if (lastFailure.kind === 'key_rejected') {
      return { state: 'failing', reason, fix: 'replace_key' };
    }
    if (lastFailure.kind === 'model_not_found') {
      return { state: 'failing', reason, fix: 'change_model' };
    }
    return { state: 'failing', reason };
  }
  if (spendFraction(ai) === 1) {
    return { state: 'paused' };
  }
  return { state: 'working' };
}
