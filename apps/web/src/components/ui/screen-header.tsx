import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';

export interface ScreenHeaderProps {
  /** `root` is a top-level screen's title; `sub` is a pushed screen's 64 px row. */
  variant: 'root' | 'sub';
  title: string;
  /** One muted line under the title. Not drawn when `bare`. */
  subtitle?: string | undefined;
  /** A sub-screen's back key. */
  onBack?: (() => void) | undefined;
  /** The back key's accessible name. */
  backLabel?: string | undefined;
  /** A key at the right end of the row. */
  right?: ReactNode | undefined;
  /** Sub only: draw the row and let the body own the title. */
  bare?: boolean | undefined;
}

/** The one header every screen shares (ui-consistency.md §1.1–§1.2, §4.1). */
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
