import { useRef, type ReactNode, type RefObject } from 'react';
import { useModal } from './use-modal';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name of the sheet; it has no built-in header. */
  ariaLabel: string;
  children?: ReactNode;
  /** Element to focus on open instead of the first focusable child. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** When false, Escape and a backdrop click do not close the sheet. */
  dismissable?: boolean;
}

/**
 * A right-side drawer for chat panels. It shares focus, Escape and Tab
 * behaviour with `Dialog`: Escape closes only the topmost overlay and stops
 * before window listeners, focus moves in on open and back on close, and Tab
 * is trapped. It has no header, so each panel renders its own.
 */
export function Sheet({
  open,
  onClose,
  ariaLabel,
  children,
  initialFocusRef,
  dismissable = true,
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onKeyDown = useModal({ open, onClose, dismissable, panelRef, initialFocusRef });

  if (!open) {
    return null;
  }

  return (
    <div
      onClick={dismissable ? onClose : undefined}
      className="fixed inset-0 z-40 flex justify-end bg-black/40"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
        className="flex h-full w-full flex-col bg-surface shadow-xl outline-none sm:w-[380px]"
      >
        {children}
      </div>
    </div>
  );
}
