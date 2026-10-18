import type { LucideIcon } from 'lucide-react';
import { IconButton } from './icon-button';

export function PanelKey({
  label,
  icon: Icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex w-16 flex-col items-center gap-1.5">
      <IconButton aria-label={label} disabled={disabled} onClick={onClick}>
        <Icon className="size-[18px]" aria-hidden="true" />
      </IconButton>
      <span className="text-[12px] text-muted-foreground">{label}</span>
    </div>
  );
}
