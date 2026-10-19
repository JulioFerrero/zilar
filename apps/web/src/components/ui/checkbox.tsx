import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';
import { Check } from 'lucide-react';

export interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string | undefined;
}

/**
 * A Base UI checkbox box. It renders no `<label>` itself: callers keep their row
 * `<label>`, so clicking the row toggles it.
 */
export function Checkbox({ checked, onCheckedChange, disabled = false, label }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className="flex size-4 shrink-0 items-center justify-center rounded border border-border-strong bg-transparent transition-colors focus-visible:ring-2 focus-visible:ring-ring data-[checked]:border-transparent data-[checked]:bg-accent data-[checked]:text-accent-foreground data-[disabled]:opacity-40"
    >
      <CheckboxPrimitive.Indicator>
        <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
