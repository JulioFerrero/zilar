import {
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface MenuProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name of the menu. */
  label: string;
  /** Accessible name of the backdrop button that closes the menu. */
  closeLabel: string;
  /** Placement classes such as `top-full right-0 mt-1`. */
  className?: string;
  /** Extra classes for the backdrop button (e.g. a higher `z-index`). */
  backdropClassName?: string;
  children?: ReactNode;
}

function enabledItems(menu: HTMLElement | null): HTMLElement[] {
  if (menu === null) {
    return [];
  }
  return [
    ...menu.querySelectorAll<HTMLElement>(
      '[role="menuitem"]:not([disabled]), [role="menuitemradio"]:not([disabled]), [role="menuitemcheckbox"]:not([disabled])',
    ),
  ];
}

/**
 * A small dropdown menu with keyboard support: focus moves to the first item
 * on open, ArrowDown/ArrowUp move between enabled items (wrapping), Home/End
 * jump to the ends, Escape closes and returns focus to the opener, and Tab
 * closes.
 */
export function Menu({
  open,
  onClose,
  label,
  closeLabel,
  className,
  backdropClassName,
  children,
}: MenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement ? active : null;
    enabledItems(menuRef.current)[0]?.focus();
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }
      event.stopPropagation();
      onCloseRef.current();
      returnFocusRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!open) {
    return null;
  }

  const moveFocus = (direction: 1 | -1): void => {
    const items = enabledItems(menuRef.current);
    if (items.length === 0) {
      return;
    }
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next =
      current === -1
        ? direction === 1
          ? items[0]
          : items[items.length - 1]
        : items[(current + direction + items.length) % items.length];
    next?.focus();
  };

  const focusEdge = (edge: 'first' | 'last'): void => {
    const items = enabledItems(menuRef.current);
    (edge === 'first' ? items[0] : items[items.length - 1])?.focus();
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveFocus(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveFocus(-1);
        break;
      case 'Home':
        event.preventDefault();
        focusEdge('first');
        break;
      case 'End':
        event.preventDefault();
        focusEdge('last');
        break;
      case 'Tab':
        onClose();
        break;
    }
  };

  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-label={closeLabel}
        onClick={onClose}
        className={cn('fixed inset-0 z-10 cursor-default', backdropClassName)}
      />
      <div
        ref={menuRef}
        role="menu"
        aria-label={label}
        onKeyDown={onMenuKeyDown}
        className={cn(
          'absolute z-20 min-w-[180px] rounded-xl border border-border-strong bg-surface py-1 shadow-lg',
          className,
        )}
      >
        {children}
      </div>
    </>
  );
}

export interface MenuItemProps {
  onSelect: () => void;
  /** A lucide icon drawn before the label. */
  icon?: LucideIcon;
  /** A dangerous action (sign out): the label turns red. */
  destructive?: boolean;
  disabled?: boolean;
  /** Accessible name override when the visible text is not enough. */
  ariaLabel?: string;
  children?: ReactNode;
}

export function MenuItem({
  onSelect,
  icon: Icon,
  destructive,
  disabled,
  ariaLabel,
  children,
}: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-2 text-left text-[15px] hover:bg-list-hover focus-visible:bg-list-hover focus-visible:outline-none disabled:opacity-50',
        destructive && 'text-danger',
      )}
    >
      {Icon === undefined ? null : <Icon className="size-4" aria-hidden="true" />}
      {children}
    </button>
  );
}
