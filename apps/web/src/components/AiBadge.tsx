import { cn } from '@/lib/utils';

export function AiBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border border-accent px-1.5 py-px text-[11px] leading-[14px] font-semibold tracking-wide text-accent',
        className,
      )}
    >
      AI
    </span>
  );
}
