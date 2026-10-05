import { SKELETON_DELAY_MS } from '@/components/Skeleton';
import { useDelayed } from '@/lib/useDelayed';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { cn } from '@/lib/utils';

/** Quiet skeleton in the shape of a machine card. Mirrors the real cards' height. */
export function MachineListSkeleton({ rows = 3 }: { rows?: number }) {
  const visible = useDelayed(true, SKELETON_DELAY_MS) === true;
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  if (!visible) {
    return null;
  }
  return (
    <div role="status" aria-label="Loading machines" className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className={cn(
            'flex flex-col gap-3 rounded-xl border border-divider bg-surface p-4',
            !reduceMotion && 'animate-pulse',
            reduceMotion && 'skeleton-reduced',
          )}
        >
          <div className="flex items-start justify-between">
            <div className="h-5 w-32 rounded-full bg-surface-raised" />
            <div className="h-5 w-16 rounded-full bg-surface-raised" />
          </div>
          <div className="h-3.5 w-3/4 rounded-full bg-surface-raised" />
          <div className="h-3.5 w-2/3 rounded-full bg-surface-raised" />
          <div className="h-8 w-full rounded-md bg-surface-raised" />
        </div>
      ))}
    </div>
  );
}
