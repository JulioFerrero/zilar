import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Presentational pieces of the dialog shell (`ui-style.md` D24 + the approved
 * New AI boards). `dialog.tsx` composes them so the shell itself stays small.
 */

export interface DialogHeaderProps {
  title: string;
  description?: string;
  /** Optional step bar slot, drawn under the title. */
  stepper?: ReactNode;
  onClose: () => void;
  /** The close key is disabled while the dialog is busy. */
  closeDisabled: boolean;
}

export function DialogHeader({
  title,
  description,
  stepper,
  onClose,
  closeDisabled,
}: DialogHeaderProps) {
  return (
    <>
      <div className="flex shrink-0 items-center gap-3 pt-4 pr-4 pl-5">
        <div className="min-w-0 flex-1">
          <DialogPrimitive.Title className="text-[18px] font-semibold tracking-[-0.02em]">
            {title}
          </DialogPrimitive.Title>
          {description === undefined ? null : (
            <DialogPrimitive.Description className="mt-1 text-[14px] text-muted-foreground">
              {description}
            </DialogPrimitive.Description>
          )}
        </div>
        <button
          type="button"
          aria-label="Close"
          disabled={closeDisabled}
          onClick={onClose}
          className="key-icon inline-flex size-8 shrink-0 items-center justify-center rounded-[10px] disabled:pointer-events-none disabled:opacity-50"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      {stepper === undefined ? null : <div className="mt-4 shrink-0 px-5">{stepper}</div>}
    </>
  );
}

/** The scrolling body of the dialog. */
export function DialogBody({ children }: { children?: ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>;
}

/** The fixed footer: a hairline with right-aligned keys. */
export function DialogFooter({ children }: { children?: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3.5">
      {children}
    </div>
  );
}

/** A fixed 13 px error line shown above the footer. */
export function DialogError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="shrink-0 px-5 pb-3 text-[13px] text-danger">
      {children}
    </p>
  );
}
