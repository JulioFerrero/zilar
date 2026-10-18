import { formatUsd } from '@zilar/chat-core';
import type { PublicAi } from '@/lib/api';
import { cn } from '@/lib/utils';

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

export function UsageBlock({ ai }: { ai: PublicAi }) {
  const usage = ai.usage ?? null;
  const perDayUsd = ai.limits.perDayUsd;
  const perMonthUsd = ai.limits.perMonthUsd;
  return (
    <section aria-label="Usage" className="flex flex-col gap-2">
      <h3 className="text-[14px] font-medium">Usage</h3>
      {usage === null ? (
        <p className="text-[13px] text-muted-foreground">Usage unavailable</p>
      ) : (
        <>
          {perDayUsd === null ? (
            <p className="text-[13px] text-muted-foreground">Today {formatUsd(usage.todayUsd)}</p>
          ) : (
            <UsageMeter
              label="Today's spend"
              text={`Today ${formatUsd(usage.todayUsd)} of ${formatUsd(perDayUsd)}`}
              fraction={perDayUsd > 0 ? usage.todayUsd / perDayUsd : 1}
            />
          )}
          {perMonthUsd === null ? (
            <p className="text-[13px] text-muted-foreground">
              30 days {formatUsd(usage.windowUsd)}
            </p>
          ) : (
            <UsageMeter
              label="30-day window spend"
              text={`30 days ${formatUsd(usage.windowUsd)} of ${formatUsd(perMonthUsd)}`}
              fraction={perMonthUsd > 0 ? usage.windowUsd / perMonthUsd : 1}
            />
          )}
        </>
      )}
      <p className="text-[13px] text-muted-foreground">Spend updates after each reply.</p>
    </section>
  );
}
