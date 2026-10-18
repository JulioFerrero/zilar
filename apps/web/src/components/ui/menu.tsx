import { Menu as BaseMenu } from '@base-ui/react/menu';
import type { LucideIcon } from 'lucide-react';
import { useRef, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface MenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  trigger?: ReactElement;
  anchorClassName?: string;
  point?: { x: number; y: number };
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  children?: ReactNode;
}

const PANEL =
  'max-h-[var(--available-height)] min-w-[180px] overflow-y-auto rounded-xl border border-border-strong bg-surface py-1 shadow-lg outline-none origin-[var(--transform-origin)] transition-[opacity,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] data-[starting-style]:opacity-0 data-[starting-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[ending-style]:scale-[0.97] data-[ending-style]:duration-100 motion-reduce:transition-opacity';

const ITEM =
  'flex w-full items-center gap-2 px-3 py-2 text-left text-[15px] select-none outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-list-hover';

function pointAnchor(x: number, y: number): { getBoundingClientRect: () => DOMRect } {
  const rect = { x, y, width: 0, height: 0, top: y, right: x, bottom: y, left: x };
  return { getBoundingClientRect: () => ({ ...rect, toJSON: () => rect }) as DOMRect };
}

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
  icon?: LucideIcon;
  destructive?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
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
  ariaLabel?: string;
  className?: string;
  children?: ReactNode;
}

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
