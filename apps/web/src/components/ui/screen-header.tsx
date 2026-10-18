import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';

export interface ScreenHeaderProps {
  variant: 'root' | 'sub';
  title: string;
  subtitle?: string | undefined;
  onBack?: (() => void) | undefined;
  backLabel?: string | undefined;
  right?: ReactNode | undefined;
  bare?: boolean | undefined;
}

export function ScreenHeader({
  variant,
  title,
  subtitle,
  onBack,
  backLabel = 'Back',
  right,
  bare,
}: ScreenHeaderProps) {
  if (variant === 'root') {
    return (
      <h1 className="px-4 pt-2 text-[28px] leading-9 font-semibold tracking-[-0.02em]">{title}</h1>
    );
  }

  return (
    <header className="shrink-0 border-b border-divider px-4">
      <div className="flex h-16 items-center gap-2">
        {onBack !== undefined && (
          <IconButton aria-label={backLabel} onClick={onBack}>
            <ArrowLeft size={18} aria-hidden="true" />
          </IconButton>
        )}
        {!bare && (
          <div className="flex min-w-0 flex-col">
            <h1 className="truncate text-[17px] font-semibold tracking-[-0.02em]">{title}</h1>
            {subtitle !== undefined && (
              <p className="truncate text-[14px] text-muted-foreground">{subtitle}</p>
            )}
          </div>
        )}
        {right !== undefined && <div className="ml-auto shrink-0">{right}</div>}
      </div>
    </header>
  );
}
