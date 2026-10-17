import type { FormEvent, ReactNode, RefObject } from 'react';
import { useRef, useState } from 'react';
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
  const [leaving, setLeaving] = useState(false);
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
      open={open && !leaving}
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
        setLeaving(true);
      }}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen && leaving) {
          setLeaving(false);
          onClose();
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          forceRender={forceRenderBackdrop}
          className="fixed inset-0 z-40 bg-black/60 transition-opacity duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] starting:opacity-0 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 data-[ending-style]:duration-150"
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
              'transition-[opacity,scale,translate] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] starting:opacity-0 starting:scale-[0.97] data-[starting-style]:opacity-0 data-[starting-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[ending-style]:scale-[0.97] data-[ending-style]:duration-150 max-sm:duration-300 max-sm:ease-[cubic-bezier(0.32,0.72,0,1)] max-sm:starting:opacity-100 max-sm:starting:scale-100 max-sm:starting:translate-y-full max-sm:data-[starting-style]:scale-100 max-sm:data-[starting-style]:opacity-100 max-sm:data-[starting-style]:translate-y-full max-sm:data-[ending-style]:scale-100 max-sm:data-[ending-style]:opacity-100 max-sm:data-[ending-style]:translate-y-full max-sm:data-[ending-style]:duration-200 motion-reduce:transition-opacity',
              size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-lg' : 'max-w-md',
            )}
          >
            <DialogHeader
              title={title}
              {...(description === undefined ? {} : { description })}
              {...(stepper === undefined ? {} : { stepper })}
              onClose={() => setLeaving(true)}
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
