import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Accessible name for the checkbox (rendered as `aria-label`). */
  label?: string | undefined;
}

/**
 * A checkbox in the folder editor's style: a screen-reader-only native
 * input plus a visual box. It renders no `<label>` itself: callers keep
 * their row `<label>`, so clicking the row toggles it.
 */
export function Checkbox({ checked, onCheckedChange, disabled = false, label }: CheckboxProps) {
  return (
    <>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={() => onCheckedChange(!checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring',
          checked
            ? 'border-transparent bg-accent text-accent-foreground'
            : 'border-border-strong bg-transparent',
          disabled && 'opacity-40',
        )}
      >
        {checked && <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />}
      </span>
    </>
  );
}
