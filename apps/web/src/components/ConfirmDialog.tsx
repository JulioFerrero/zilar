import { useRef } from 'react';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';

export interface ConfirmDialogProps {
  title: string;
  body: string;
  /** The destructive action's label, e.g. "Delete". */
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /**
   * T-1247: an optional second destructive choice shown before the confirm
   * action, e.g. "Delete for me" beside "Delete for everyone".
   */
  secondLabel?: string;
  onSecond?: () => void;
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
  secondLabel,
  onSecond,
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
          <Button ref={cancelRef} type="button" variant="ghost" size="lg" onClick={onCancel}>
            Cancel
          </Button>
          {secondLabel !== undefined && (
            <Button type="button" variant="destructive" size="lg" onClick={onSecond}>
              {secondLabel}
            </Button>
          )}
          <Button type="button" variant="destructive" size="lg" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
