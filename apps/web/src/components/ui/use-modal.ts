import {
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

interface UseModalOptions {
  open: boolean;
  onClose: () => void;
  dismissable: boolean;
  panelRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null> | undefined;
}

/**
 * Shared behaviour for the kit overlays (`Dialog` and `Sheet`): focus moves in
 * on open and back on close, Escape closes only the topmost overlay and stops
 * before window listeners (for example `ChatShell`'s narrow-layout handler),
 * and Tab is trapped inside the panel.
 *
 * The listeners attach in a layout effect: T-0280 found an Escape can be lost
 * between the commit and a passive effect.
 */
export function useModal({
  open,
  onClose,
  dismissable,
  panelRef,
  initialFocusRef,
}: UseModalOptions): (event: ReactKeyboardEvent<HTMLElement>) => void {
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement ? active : null;
    const firstFocusable = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    const target = initialFocusRef?.current ?? firstFocusable ?? panelRef.current;
    target?.focus();
    return () => {
      returnFocusRef.current?.focus();
    };
  }, [open, initialFocusRef, panelRef]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== panelRef.current) {
        return;
      }
      // Even an undismissable modal swallows Escape: it must not bubble to
      // window listeners (ChatShell's narrow-layout handler would leave the
      // chat behind the modal).
      event.stopPropagation();
      if (dismissable) {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, dismissable, panelRef]);

  return (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Tab') {
      return;
    }
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
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
}
