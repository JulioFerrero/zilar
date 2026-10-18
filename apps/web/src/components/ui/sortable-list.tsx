import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  defaultScreenReaderInstructions,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type ScreenReaderInstructions,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { GripVertical } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type UseSortable = ReturnType<typeof useSortable>;

export interface SortableItemControls {
  attributes: UseSortable['attributes'];
  listeners: UseSortable['listeners'];
  setActivatorNodeRef: UseSortable['setActivatorNodeRef'];
  isDragging: boolean;
}

export interface SortableItemState {
  isDragging: boolean;
}

export interface SortableAccessibility {
  announcements: Announcements;
  screenReaderInstructions: ScreenReaderInstructions;
}

/**
 * dnd-kit's default announcements name the internal ids; these name the row
 * through `labelOf` and read its position, so the live region says "Personal
 * moved to position 2 of 2" instead of the raw id.
 */
export function sortableAccessibility(
  ids: string[],
  labelOf: (id: string) => string,
): SortableAccessibility {
  const total = ids.length;
  const nameOf = (id: string | number): string => labelOf(String(id));
  const positionOf = (id: string | number): string => {
    const index = ids.indexOf(String(id)) + 1;
    return index > 0 ? `position ${index} of ${total}` : 'a new position';
  };

  return {
    announcements: {
      onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}.`,
      onDragOver: ({ active, over }) => {
        if (over === null || active.id === over.id) {
          return undefined;
        }
        return `${nameOf(active.id)} moved to ${positionOf(over.id)}.`;
      },
      onDragEnd: ({ active, over }) => {
        const target = over === null ? active.id : over.id;
        return `${nameOf(active.id)} dropped at ${positionOf(target)}.`;
      },
      onDragCancel: () => 'Reorder cancelled.',
    },
    screenReaderInstructions: defaultScreenReaderInstructions,
  };
}

export interface SortableListProps {
  ids: string[];
  disabled?: boolean;
  labelOf: (id: string) => string;
  onReorder: (fromId: string, toId: string) => void;
  children: ReactNode;
}

export function SortableList({
  ids,
  disabled = false,
  labelOf,
  onReorder,
  children,
}: SortableListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const accessibility = sortableAccessibility(ids, labelOf);

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (over === null || active.id === over.id) {
      return;
    }
    onReorder(String(active.id), String(over.id));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      accessibility={accessibility}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy} disabled={disabled}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

export interface SortableItemProps {
  id: string;
  disabled?: boolean;
  className?: string | ((state: SortableItemState) => string);
  children: (controls: SortableItemControls) => ReactNode;
}

export function SortableItem({ id, disabled = false, className, children }: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });
  const style: CSSProperties = {
    transform:
      transform === null ? undefined : `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    transition,
    zIndex: isDragging ? 1 : undefined,
  };
  const resolved = typeof className === 'function' ? className({ isDragging }) : className;

  return (
    <li ref={setNodeRef} style={style} className={resolved}>
      {children({ attributes, listeners, setActivatorNodeRef, isDragging })}
    </li>
  );
}

export interface SortableHandleProps extends SortableItemControls {
  label: string;
  disabled?: boolean;
  className?: string;
}

export function SortableHandle({
  attributes,
  listeners,
  setActivatorNodeRef,
  isDragging,
  label,
  disabled = false,
  className,
}: SortableHandleProps) {
  return (
    <button
      ref={setActivatorNodeRef}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(
        'flex shrink-0 touch-none items-center justify-center rounded-lg p-1.5 text-muted-foreground',
        disabled ? 'cursor-default' : 'cursor-grab',
        !disabled && 'hover:bg-list-hover hover:text-foreground',
        isDragging && 'cursor-grabbing',
        className,
      )}
      {...attributes}
      {...(disabled ? {} : listeners)}
    >
      <GripVertical className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
