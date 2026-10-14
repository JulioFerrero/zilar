import type { ReactNode, RefObject } from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { cn } from '@/lib/utils';

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
  /**
   * T-1351: render the backdrop even when this dialog is nested inside another
   * Base UI overlay. Base UI drops a nested dialog's backdrop (`DialogBackdrop`
   * renders nothing when its root is nested), which leaves the parent overlay
   * undimmed behind a confirm; forcing it keeps the confirm clearly modal.
   */
  forceRenderBackdrop?: boolean;
}

/**
 * A generic dialog shell built on Base UI `Dialog` (portal, focus trap, Escape and
 * scroll lock). Escape closes it, focus moves in on open and back to the opener
 * on close, and the actions sit right-aligned in a footer.
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
  forceRenderBackdrop = false,
}: DialogProps) {
  return (
    <DialogPrimitive.Root
      open={open}
      disablePointerDismissal={!dismissable}
      onOpenChange={(nextOpen, eventDetails) => {
        if (nextOpen) {
          return;
        }
        // `dismissable={false}` keeps the dialog open on Escape: Base UI reports
        // it as `escape-key`, and cancelling the change leaves it mounted.
        if (!dismissable && eventDetails.reason === 'escape-key') {
          eventDetails.cancel();
          return;
        }
        onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          forceRender={forceRenderBackdrop}
          className="fixed inset-0 z-40 bg-black/40"
        />
        <DialogPrimitive.Viewport className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <DialogPrimitive.Popup
            initialFocus={initialFocusRef}
            {...(ariaLabel === undefined
              ? {}
              : { 'aria-label': ariaLabel, 'aria-labelledby': undefined })}
            className={cn(
              'flex max-h-[85vh] w-full flex-col rounded-2xl border border-border bg-panel p-5 shadow-xl outline-none',
              size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-lg' : 'max-w-md',
            )}
          >
            <DialogPrimitive.Title className="shrink-0 text-[18px] font-semibold tracking-[-0.02em]">
              {title}
            </DialogPrimitive.Title>
            {description === undefined ? null : (
              <DialogPrimitive.Description className="mt-1 shrink-0 text-[14px] text-muted-foreground">
                {description}
              </DialogPrimitive.Description>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
            {actions === undefined ? null : (
              <div className="mt-5 flex shrink-0 justify-end gap-2">{actions}</div>
            )}
          </DialogPrimitive.Popup>
        </DialogPrimitive.Viewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
