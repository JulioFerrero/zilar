import type { ReactNode, RefObject } from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';

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
 * A right-side drawer for chat panels, built on the Base UI `Dialog` primitive so
 * it shares focus, Escape and Tab behaviour with `Dialog`: Escape closes only
 * the topmost overlay and stops before window listeners, focus moves in on open
 * and back on close, and Tab is trapped. It has no header, so each panel
 * renders its own.
 */
export function Sheet({
  open,
  onClose,
  ariaLabel,
  children,
  initialFocusRef,
  dismissable = true,
}: SheetProps) {
  return (
    <DialogPrimitive.Root
      open={open}
      disablePointerDismissal={!dismissable}
      onOpenChange={(nextOpen, eventDetails) => {
        if (nextOpen) {
          return;
        }
        // `dismissable={false}` keeps the sheet open on Escape: Base UI reports
        // it as `escape-key`, and cancelling the change leaves it mounted.
        if (!dismissable && eventDetails.reason === 'escape-key') {
          eventDetails.cancel();
          return;
        }
        onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-40 bg-black/40" />
        <DialogPrimitive.Viewport className="fixed inset-0 z-40 flex justify-end">
          <DialogPrimitive.Popup
            aria-label={ariaLabel}
            initialFocus={initialFocusRef}
            className="flex h-full w-full flex-col bg-surface shadow-xl outline-none sm:w-[380px]"
          >
            {children}
          </DialogPrimitive.Popup>
        </DialogPrimitive.Viewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
