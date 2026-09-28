import type { Progress } from '@galena/protocol';
import { Loader2 } from 'lucide-react';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { cn } from '@/lib/utils';

export function ProgressCard({ progress }: { progress: Progress }) {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  return (
    <div className="bubble-in min-w-[220px] rounded-[12px] p-2.5">
      <div className="flex items-center gap-2">
        <Loader2
          className={cn(
            'size-4 shrink-0 text-accent',
            !reduceMotion && 'animate-spin',
            reduceMotion && 'spinner-reduced',
          )}
          aria-hidden="true"
        />
        <span className="text-[14px] font-medium">{progress.stage}</span>
      </div>
      {progress.detail !== undefined && (
        <p className="mt-1 text-[13px] text-muted-foreground">{progress.detail}</p>
      )}
      {progress.percent !== undefined && (
        <div
          role="progressbar"
          aria-valuenow={progress.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      )}
    </div>
  );
}
