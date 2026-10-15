import type { ReactNode } from 'react';
import { ChevronLeft, X } from 'lucide-react';
import { IconButton } from '../ui/icon-button';

/**
 * A subpage of the group info panel (T-1494): the back and close keys, the page
 * title, and the sections of that page scrolling below.
 */
export function GroupInfoPage({
  title,
  onBack,
  onClose,
  children,
}: {
  title: string;
  onBack: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-divider p-3">
        <IconButton aria-label="Back to group info" onClick={onBack}>
          <ChevronLeft className="size-4" aria-hidden="true" />
        </IconButton>
        <h2 className="min-w-0 flex-1 truncate text-[16px] font-semibold">{title}</h2>
        <IconButton aria-label="Close group info" onClick={onClose}>
          <X className="size-4" aria-hidden="true" />
        </IconButton>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">{children}</div>
    </>
  );
}
