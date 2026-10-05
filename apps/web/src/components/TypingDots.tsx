import { cn } from '@/lib/utils';

/** Three animated dots, used for `typing…` and `AI · working…`. */
export function TypingDots({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="typing-dot size-1 rounded-full bg-current"
          style={{ animationDelay: `${index * 0.2}s` }}
        />
      ))}
    </span>
  );
}
