import type { PublicAi } from '@/lib/api';
import { cn } from '@/lib/utils';

/** `$2` -> `$2.00`. Server amounts are plain USD numbers. */
function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

/**
 * One thin spend meter: a well track with a `#ededed` fill, turning
 * `--danger` at or above 100% (ui-style.md §4).
 */
function UsageMeter({ label, text, fraction }: { label: string; text: string; fraction: number }) {
  const clamped = Math.min(1, Math.max(0, fraction));
  const over = fraction >= 1;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[13px] text-muted-foreground">{text}</p>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped * 100)}
        className="well-surface h-1 overflow-hidden rounded-full"
      >
        <div
          className={cn('h-full rounded-full', over && 'bg-danger')}
          style={{
            width: `${Math.round(clamped * 100)}%`,
            ...(over ? {} : { backgroundColor: '#ededed' }),
          }}
        />
      </div>
    </div>
  );
}

/**
 * The AI's spend (T-0058): today's spend against the daily cap and the key's
 * current spend against the monthly cap. LiteLLM tracks spend in batches, so
 * the numbers lag a turn or two — the help text says so.
 */
export function UsageBlock({ ai }: { ai: PublicAi }) {
  const usage = ai.usage ?? null;
  return (
    <section aria-label="Usage" className="flex flex-col gap-2">
      <h3 className="text-[14px] font-medium">Usage</h3>
      {usage === null ? (
        <p className="text-[13px] text-muted-foreground">Usage unavailable</p>
      ) : (
        <>
          <UsageMeter
            label="Today's spend"
            text={`Today ${formatUsd(usage.todayUsd)} of ${formatUsd(ai.limits.perDayUsd)}`}
            fraction={ai.limits.perDayUsd > 0 ? usage.todayUsd / ai.limits.perDayUsd : 1}
          />
          <UsageMeter
            label="30-day window spend"
            text={`30-day window ${formatUsd(usage.windowUsd)} of ${formatUsd(ai.limits.perMonthUsd)}`}
            fraction={ai.limits.perMonthUsd > 0 ? usage.windowUsd / ai.limits.perMonthUsd : 1}
          />
        </>
      )}
      <p className="text-[13px] text-muted-foreground">
        Spend updates within a minute or two; the daily limit may let a last reply through.
      </p>
    </section>
  );
}
