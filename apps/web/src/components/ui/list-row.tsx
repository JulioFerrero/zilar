import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';

export interface ListRowProps {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  chevron?: boolean;
  onClick?: () => void;
  href?: string;
  danger?: boolean;
}

/**
 * A settings-style row: a 32 px key tile, a title, a one-line muted subtitle
 * and an optional chevron. It renders a button when it acts, a router Link
 * when it points somewhere, and a plain div otherwise.
 */
export function ListRow({
  icon,
  title,
  subtitle,
  trailing,
  chevron = false,
  onClick,
  href,
  danger = false,
}: ListRowProps) {
  const content = (
    <>
      {icon === undefined ? null : (
        <span
          aria-hidden="true"
          className="key-icon flex size-8 shrink-0 items-center justify-center rounded-[10px]"
        >
          {icon}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            'truncate text-[14px] font-medium',
            danger ? 'text-danger' : 'text-foreground',
          )}
        >
          {title}
        </span>
        {subtitle === undefined ? null : (
          <span className="truncate text-[13px] text-muted-foreground">{subtitle}</span>
        )}
      </span>
      {trailing === undefined ? null : (
        <span className="shrink-0 text-[13px] text-muted-foreground">{trailing}</span>
      )}
      {chevron && (
        <ChevronRight className="size-4 shrink-0 text-subtle-foreground" aria-hidden="true" />
      )}
    </>
  );

  const rowClass = cn(
    'flex w-full items-center gap-3 px-3 py-2.5 text-left',
    (onClick !== undefined || href !== undefined) && 'transition-colors hover:bg-surface-raised',
  );

  if (href !== undefined) {
    return (
      <Link to={href} className={rowClass}>
        {content}
      </Link>
    );
  }

  if (onClick !== undefined) {
    return (
      <button type="button" onClick={onClick} className={rowClass}>
        {content}
      </button>
    );
  }

  return <div className={rowClass}>{content}</div>;
}
