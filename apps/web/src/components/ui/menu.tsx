import { Menu as BaseMenu } from '@base-ui/react/menu';
import type { LucideIcon } from 'lucide-react';
import { useRef, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface MenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible name of the menu. */
  label: string;
  /**
   * The opener button. Base UI wires it as the trigger: it opens on click and
   * on Enter/Space/ArrowDown, and focus returns to it on close.
   */
  trigger?: ReactElement;
  /**
   * Class for an invisible positioned element that anchors the panel when the
   * opener button lives in a parent (`ChatListItem`, `TopicRow`, `MessageMenu`)
   * and there is no trigger of its own.
   */
  anchorClassName?: string;
  /**
   * A viewport point (right-click) to anchor the panel to, instead of a
   * trigger. Base UI keeps the panel inside the viewport near an edge.
   */
  point?: { x: number; y: number };
  /** Which side of the anchor the panel opens on. Defaults to `bottom`. */
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** How the panel lines up with the anchor. Defaults to `start`. */
  align?: 'start' | 'center' | 'end';
  /** Gap in pixels between the anchor and the panel. Defaults to 4. */
  sideOffset?: number;
  children?: ReactNode;
}

const PANEL =
  'max-h-[var(--available-height)] min-w-[180px] overflow-y-auto rounded-xl border border-border-strong bg-surface py-1 shadow-lg outline-none origin-[var(--transform-origin)] transition-[opacity,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] data-[starting-style]:opacity-0 data-[starting-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[ending-style]:scale-[0.97] data-[ending-style]:duration-100 motion-reduce:transition-opacity';

const ITEM =
  'flex w-full items-center gap-2 px-3 py-2 text-left text-[15px] select-none outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-list-hover';

/** A zero-size virtual element at a viewport point, for the right-click anchor. */
function pointAnchor(x: number, y: number): { getBoundingClientRect: () => DOMRect } {
  const rect = { x, y, width: 0, height: 0, top: y, right: x, bottom: y, left: x };
  return { getBoundingClientRect: () => ({ ...rect, toJSON: () => rect }) as DOMRect };
}

/**
 * A dropdown menu built on Base UI `Menu`: the panel is portalled, it flips and
 * shifts to stay inside the viewport (`collisionPadding` 8), and it gets
 * keyboard support (arrows, Home/End, typeahead, Escape, focus back to the
 * anchor) from Base UI.
 */
export function Menu({
  open,
  onOpenChange,
  label,
  trigger,
  anchorClassName,
  point,
  side = 'bottom',
  align = 'start',
  sideOffset = 4,
  children,
}: MenuProps) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);

  return (
    <BaseMenu.Root open={open} onOpenChange={onOpenChange}>
      {trigger !== undefined && <BaseMenu.Trigger render={trigger} />}
      {anchorClassName !== undefined && (
        <span ref={anchorRef} aria-hidden="true" className={anchorClassName} />
      )}
      <BaseMenu.Portal>
        <BaseMenu.Positioner
          className="z-50"
          side={side}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={8}
          {...(point !== undefined
            ? { anchor: () => pointAnchor(point.x, point.y) }
            : anchorClassName !== undefined
              ? { anchor: anchorRef }
              : {})}
        >
          <BaseMenu.Popup aria-label={label} className={PANEL}>
            {children}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}

export interface MenuItemProps {
  onSelect: (event: MouseEvent<HTMLElement>) => void;
  /** A lucide icon drawn before the label. */
  icon?: LucideIcon;
  /** A dangerous action (sign out): the label turns red. */
  destructive?: boolean;
  disabled?: boolean;
  /** Accessible name override when the visible text is not enough. */
  ariaLabel?: string;
  /** When false the menu stays open after the click (the Mute… durations). */
  closeOnClick?: boolean;
  children?: ReactNode;
}

export function MenuItem({
  onSelect,
  icon: Icon,
  destructive,
  disabled,
  ariaLabel,
  closeOnClick,
  children,
}: MenuItemProps) {
  return (
    <BaseMenu.Item
      disabled={disabled ?? false}
      closeOnClick={closeOnClick ?? true}
      aria-label={ariaLabel}
      onClick={onSelect}
      className={cn(ITEM, destructive && 'text-danger')}
    >
      {Icon === undefined ? null : <Icon className="size-4" aria-hidden="true" />}
      {children}
    </BaseMenu.Item>
  );
}

export interface MenuEntryProps {
  onSelect: (event: MouseEvent<HTMLElement>) => void;
  disabled?: boolean;
  /** Accessible name; required when the entry has no visible text. */
  ariaLabel?: string;
  /** Extra classes; this entry carries no built-in layout. */
  className?: string;
  children?: ReactNode;
}

/** An entry with fully custom content, for the reaction bar's emoji keys. */
export function MenuEntry({ onSelect, disabled, ariaLabel, className, children }: MenuEntryProps) {
  return (
    <BaseMenu.Item
      disabled={disabled ?? false}
      aria-label={ariaLabel}
      onClick={onSelect}
      className={cn('select-none outline-none data-[disabled]:opacity-50', className)}
    >
      {children}
    </BaseMenu.Item>
  );
}

export interface MenuRadioGroupProps {
  /** The selected item's value. */
  value: string;
  onValueChange: (value: string) => void;
  children?: ReactNode;
}

/** The group that owns a set of `MenuRadioItem`s and their single selection. */
export function MenuRadioGroup({ value, onValueChange, children }: MenuRadioGroupProps) {
  return (
    <BaseMenu.RadioGroup value={value} onValueChange={onValueChange}>
      {children}
    </BaseMenu.RadioGroup>
  );
}

export interface MenuRadioItemProps {
  value: string;
  disabled?: boolean;
  /** Accessible name override when the visible text is not enough. */
  ariaLabel?: string;
  /** When false the menu stays open after picking (Base UI's default). */
  closeOnClick?: boolean;
  /** Extra classes merged with the base item classes. */
  className?: string;
  children?: ReactNode;
}

export function MenuRadioItem({
  value,
  disabled,
  ariaLabel,
  closeOnClick,
  className,
  children,
}: MenuRadioItemProps) {
  return (
    <BaseMenu.RadioItem
      value={value}
      disabled={disabled ?? false}
      closeOnClick={closeOnClick ?? true}
      aria-label={ariaLabel}
      className={cn(ITEM, className)}
    >
      {children}
    </BaseMenu.RadioItem>
  );
}
