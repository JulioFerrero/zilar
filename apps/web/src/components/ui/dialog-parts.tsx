import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

export interface DialogHeaderProps {
  title: string;
  description?: string;
  stepper?: ReactNode;
  onClose: () => void;
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

export function DialogBody({ children }: { children?: ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>;
}

export function DialogFooter({ children }: { children?: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3.5">
      {children}
    </div>
  );
}

export function DialogError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="shrink-0 px-5 pb-3 text-[13px] text-danger">
      {children}
    </p>
  );
}
