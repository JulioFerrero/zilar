import { useRef, type KeyboardEvent } from 'react';
import { Badge } from './badge';
import { cn } from '@/lib/utils';

export interface SegmentedOption {
  value: string;
  label: string;
  count?: number;
}

export interface SegmentedControlProps {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  mode?: 'tabs' | 'radio';
}

/**
 * A well track with the active option raised (`ui-style.md` §5). Arrow keys,
 * Home and End move the selection, following the tablist pattern in §7.
 */
export function SegmentedControl({
  options,
  value,
  onChange,
  ariaLabel,
  mode = 'tabs',
}: SegmentedControlProps) {
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const last = options.length - 1;
    let next: number | undefined;
    if (event.key === 'ArrowRight') {
      next = index === last ? 0 : index + 1;
    } else if (event.key === 'ArrowLeft') {
      next = index === 0 ? last : index - 1;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = last;
    }
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    const option = options[next];
    if (option === undefined) {
      return;
    }
    if (option.value !== value) {
      onChange(option.value);
    }
    optionRefs.current[next]?.focus();
  };

  const isRadio = mode === 'radio';

  return (
    <div
      role={isRadio ? 'radiogroup' : 'tablist'}
      aria-label={ariaLabel}
      className="well-surface flex gap-1 rounded-[10px] p-[3px]"
    >
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              optionRefs.current[index] = element;
            }}
            type="button"
            role={isRadio ? 'radio' : 'tab'}
            {...(isRadio ? { 'aria-checked': active } : { 'aria-selected': active })}
            tabIndex={active ? 0 : -1}
            onClick={() => {
              if (option.value !== value) {
                onChange(option.value);
              }
            }}
            onKeyDown={(event) => move(event, index)}
            className={cn(
              'flex h-[30px] flex-1 items-center justify-center gap-1.5 rounded-[7px] px-3 text-[13px] font-medium transition-colors',
              active
                ? 'segment-raised text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
            {option.count === undefined ? null : <Badge count={option.count} muted={!active} />}
          </button>
        );
      })}
    </div>
  );
}
