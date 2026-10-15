import type { FormEvent, ReactNode, RefObject } from 'react';
import { useRef } from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { cn } from '@/lib/utils';
import { DialogBody, DialogError, DialogFooter, DialogHeader } from './dialog-parts';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  /** Keys in the footer, aligned right. Kept for existing dialogs. */
  actions?: ReactNode;
  /** A custom footer that replaces `actions` and gets the hairline treatment. */
  footer?: ReactNode;
  /** Optional step bar, for example a `DialogStepper`. */
  stepper?: ReactNode;
  /** A fixed error line above the footer. */
  error?: ReactNode;
  /** When set, the body and footer are wrapped in a form so Enter submits. */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  /** While busy, Escape, the backdrop and the close key are all off. */
  busy?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** Element to focus on open instead of the first `[data-autofocus]` element. */
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
 * on close. It has a header with a close key, an optional step bar, a scrolling
 * body, an optional error line and a footer with a hairline.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  actions,
  footer,
  stepper,
  error,
  onSubmit,
  busy = false,
  size = 'md',
  initialFocusRef,
  ariaLabel,
  dismissable = true,
  forceRenderBackdrop = false,
}: DialogProps) {
  const popupRef = useRef<HTMLDivElement>(null);
  const closable = dismissable && !busy;

  // First focus goes to `[data-autofocus]` when one exists, otherwise to the
  // popup itself so the header close key is never focused first.
  const focusTarget = (): HTMLElement | null => {
    if (initialFocusRef !== undefined && initialFocusRef.current !== null) {
      return initialFocusRef.current;
    }
    return popupRef.current?.querySelector<HTMLElement>('[data-autofocus]') ?? popupRef.current;
  };

  const body = (
    <>
      <DialogBody>{children}</DialogBody>
      {error === undefined ? null : <DialogError>{error}</DialogError>}
      {footer === undefined && actions === undefined ? null : (
        <DialogFooter>{footer ?? actions}</DialogFooter>
      )}
    </>
  );

  return (
    <DialogPrimitive.Root
      open={open}
      disablePointerDismissal={!closable}
      onOpenChange={(nextOpen, eventDetails) => {
        if (nextOpen) {
          return;
        }
        // `dismissable={false}` and `busy` cancel Base UI's Escape close.
        if (!closable && eventDetails.reason === 'escape-key') {
          eventDetails.cancel();
          return;
        }
        onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          forceRender={forceRenderBackdrop}
          className="fixed inset-0 z-40 bg-black/60"
        />
        <DialogPrimitive.Viewport className="fixed inset-0 z-40 flex items-center justify-center p-4 max-sm:items-end max-sm:p-0">
          <DialogPrimitive.Popup
            ref={popupRef}
            initialFocus={focusTarget}
            {...(ariaLabel === undefined
              ? {}
              : { 'aria-label': ariaLabel, 'aria-labelledby': undefined })}
            className={cn(
              'flex max-h-[85vh] w-full flex-col rounded-2xl border border-border bg-panel shadow-[0_24px_60px_rgba(0,0,0,0.8)] outline-none',
              'max-sm:max-w-none max-sm:rounded-b-none',
              size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-lg' : 'max-w-md',
            )}
          >
            <DialogHeader
              title={title}
              {...(description === undefined ? {} : { description })}
              {...(stepper === undefined ? {} : { stepper })}
              onClose={onClose}
              closeDisabled={busy}
            />
            {onSubmit === undefined ? (
              <div className="flex min-h-0 flex-1 flex-col">{body}</div>
            ) : (
              <form noValidate onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
                {body}
              </form>
            )}
          </DialogPrimitive.Popup>
        </DialogPrimitive.Viewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
