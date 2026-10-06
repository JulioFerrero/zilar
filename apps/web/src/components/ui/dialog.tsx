import { useId, useRef, type ReactNode, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import { useModal } from './use-modal';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  actions?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Element to focus on open instead of the first focusable child. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Accessible name when it should differ from the visible title. */
  ariaLabel?: string;
  /** When false, Escape and a backdrop click do not close the dialog. */
  dismissable?: boolean;
}

/**
 * A generic dialog shell with the same focus behaviour as ConfirmDialog:
 * Escape closes it, focus is trapped inside while open, and focus returns
 * to the element focused when it opened. Actions sit right-aligned in
 * a footer.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  actions,
  size = 'md',
  initialFocusRef,
  ariaLabel,
  dismissable = true,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onKeyDown = useModal({ open, onClose, dismissable, panelRef, initialFocusRef });

  if (!open) {
    return null;
  }

  return (
    <div
      onClick={dismissable ? onClose : undefined}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabel === undefined ? titleId : undefined}
        aria-label={ariaLabel}
        aria-describedby={description === undefined ? undefined : descriptionId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
        className={cn(
          'flex max-h-[85vh] w-full flex-col rounded-2xl border border-border bg-panel p-5 shadow-xl outline-none',
          size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-lg' : 'max-w-md',
        )}
      >
        <h2 id={titleId} className="shrink-0 text-[18px] font-semibold tracking-[-0.02em]">
          {title}
        </h2>
        {description === undefined ? null : (
          <p id={descriptionId} className="mt-1 shrink-0 text-[14px] text-muted-foreground">
            {description}
          </p>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {actions === undefined ? null : (
          <div className="mt-5 flex shrink-0 justify-end gap-2">{actions}</div>
        )}
      </div>
    </div>
  );
}
