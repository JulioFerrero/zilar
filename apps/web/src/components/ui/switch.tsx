import { useId } from 'react';
import { cn } from '@/lib/utils';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

/** A labelled switch. Space and Enter toggle it via the native button. */
export function Switch({ checked, onCheckedChange, label, disabled = false }: SwitchProps) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:pointer-events-none disabled:opacity-50',
          checked ? 'key-primary border-0' : 'well-surface',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'key-icon absolute top-0.5 left-0.5 block size-5 rounded-full transition-transform',
            checked && 'translate-x-5',
          )}
        />
      </button>
      <label htmlFor={id} className="text-[14px]">
        {label}
      </label>
    </div>
  );
}
