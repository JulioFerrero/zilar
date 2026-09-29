import { useMediaQuery } from '@/lib/useMediaQuery';
import { SKELETON_DELAY_MS } from '@/components/Skeleton';
import { useDelayed } from '@/lib/useDelayed';
import { cn } from '@/lib/utils';

/** Quiet skeleton in the shape of an approval row. */
export function ApprovalsListSkeleton({ rows = 2 }: { rows?: number }) {
  const visible = useDelayed(true, SKELETON_DELAY_MS) === true;
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  if (!visible) {
    return null;
  }
  return (
    <div role="status" aria-label="Loading approvals" className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className={cn(
            'flex flex-col gap-2 rounded-xl border border-divider bg-surface p-4',
            !reduceMotion && 'animate-pulse',
            reduceMotion && 'skeleton-reduced',
          )}
        >
          <div className="h-5 w-40 rounded-full bg-surface-raised" />
          <div className="h-3.5 w-3/4 rounded-full bg-surface-raised" />
          <div className="h-3.5 w-2/3 rounded-full bg-surface-raised" />
          <div className="mt-1 h-3 w-32 rounded-full bg-surface-raised" />
          <div className="mt-2 flex gap-2">
            <div className="h-8 w-20 rounded-full bg-surface-raised" />
            <div className="h-8 w-16 rounded-full bg-surface-raised" />
          </div>
        </div>
      ))}
    </div>
  );
}
