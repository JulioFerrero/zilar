import { useRef } from 'react';
import { cn } from '@/lib/utils';
import { Dialog } from './ui/dialog';

export interface ConfirmDialogProps {
  title: string;
  body: string;
  /** The destructive action's label, e.g. "Delete". */
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A small confirmation dialog for a destructive action: Escape and Cancel
 * dismiss it, the confirm key is a danger button, focus starts on Cancel and
 * returns to the element focused when it opened.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open
      onClose={onCancel}
      title={title}
      description={body}
      size="sm"
      initialFocusRef={cancelRef}
      actions={
        <>
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
        </>
      }
    />
  );
}
