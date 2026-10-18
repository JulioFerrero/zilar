import { cn } from '@/lib/utils';

export function AiBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'font-mono inline-flex shrink-0 items-center rounded-[5px] border border-badge-muted px-1 text-[10px] leading-[15px] text-muted-foreground',
        className,
      )}
    >
      AI
    </span>
  );
}
