import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import { useId } from 'react';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  hideLabel?: boolean;
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled = false,
  hideLabel = false,
}: SwitchProps) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <SwitchPrimitive.Root
        id={id}
        nativeButton
        render={<button type="button" />}
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={hideLabel ? label : undefined}
        disabled={disabled}
        className="well-surface relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:pointer-events-none disabled:opacity-50 data-[checked]:key-primary data-[checked]:border-0"
      >
        <SwitchPrimitive.Thumb className="key-icon absolute top-0.5 left-0.5 block size-5 rounded-full transition-transform data-[checked]:translate-x-5" />
      </SwitchPrimitive.Root>
      {!hideLabel && (
        <label htmlFor={id} className="text-[14px]">
          {label}
        </label>
      )}
    </div>
  );
}
