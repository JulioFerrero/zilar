import { useRef } from 'react';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';

export interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  secondLabel?: string;
  onSecond?: () => void;
}

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
      forceRenderBackdrop
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
