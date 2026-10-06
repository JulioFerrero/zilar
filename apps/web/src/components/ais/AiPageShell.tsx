import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** A single wrapped option row used by the provider, template and model pickers. */
export function SelectOption({
  selected,
  disabled = false,
  onClick,
  children,
  className,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-50',
        selected
          ? 'border-accent bg-accent/10'
          : 'border-divider hover:bg-list-hover hover:border-muted-foreground/40',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** An inline, red validation or server message with an accessible role. */
export function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-[13px] text-danger">
      {children}
    </p>
  );
}

export { Button };
