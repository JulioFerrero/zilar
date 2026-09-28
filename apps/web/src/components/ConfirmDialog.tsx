import { useEffect, useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';

export interface ConfirmDialogProps {
  title: string;
  body: string;
  /** The destructive action's label, e.g. "Delete". */
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * A small confirmation dialog for a destructive action: Escape and Cancel
 * dismiss it, the confirm key is a danger button, focus is trapped inside and
 * returns to the element focused when it opened.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement ? active : null;
    cancelRef.current?.focus();
    return () => {
      returnFocusRef.current?.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (focusable === undefined || focusable.length === 0) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) {
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onCancel}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
    >
      <div
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
        className="w-full max-w-sm rounded-2xl border border-border-strong bg-surface p-5 shadow-xl"
      >
        <h2 className="text-[18px] font-semibold">{title}</h2>
        <p className="mt-1 text-[14px] text-muted-foreground">{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-full px-4 py-1.5 text-[15px] text-muted-foreground hover:bg-list-hover focus-visible:outline-none"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              'rounded-full bg-danger px-4 py-1.5 text-[15px] font-medium text-white',
              'hover:bg-danger/90 focus-visible:outline-none',
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
