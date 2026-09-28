import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Shared page frame for the AI screens: a back-arrow header, a title and
 * subtitle, then a scrolling body. Same shape as ConnectionsPage so the two
 * settings screens feel alike.
 */
export function AiPageShell({
  title,
  subtitle,
  onBack,
  children,
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-divider px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Back"
            onClick={onBack}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-list-hover"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-5"
              aria-hidden="true"
            >
              <path d="m12 19-7-7 7-7" />
              <path d="M19 12H5" />
            </svg>
          </button>
          <h1 className="text-[20px] leading-7 font-semibold">{title}</h1>
        </div>
        {subtitle !== undefined && (
          <p className="mt-1 text-[14px] text-muted-foreground">{subtitle}</p>
        )}
      </header>
      <div className="flex-1 overflow-auto p-4">{children}</div>
    </div>
  );
}

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
