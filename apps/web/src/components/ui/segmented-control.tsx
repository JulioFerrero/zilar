import type { LucideIcon } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';
import { Badge } from './badge';
import { cn } from '@/lib/utils';

export interface SegmentedOption {
  value: string;
  label: string;
  count?: number;
  /** A lucide icon drawn before the label; only used by the `choice` tone. */
  icon?: LucideIcon;
}

export interface SegmentedControlProps {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  mode?: 'tabs' | 'radio';
  /**
   * `tab` is the folder track (the active tab is the dark raised segment).
   * `choice` is the New AI selection: a taller row whose selected option is the
   * light key (ui-style.md D24 + the approved New AI boards).
   */
  tone?: 'tab' | 'choice';
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
  tone = 'tab',
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
  const isChoice = tone === 'choice';

  return (
    <div
      role={isRadio ? 'radiogroup' : 'tablist'}
      aria-label={ariaLabel}
      className={cn('well-surface flex rounded-[10px] p-[3px]', isChoice ? 'gap-0.5' : 'gap-1')}
    >
      {options.map((option, index) => {
        const active = option.value === value;
        const Icon = option.icon;
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
              'flex flex-1 items-center justify-center font-medium transition-colors',
              isChoice
                ? 'h-[34px] gap-[7px] rounded-[7px] px-3 text-[13px] leading-none'
                : 'h-[30px] gap-1.5 rounded-[7px] px-3 text-[13px]',
              active
                ? isChoice
                  ? 'segment-choice'
                  : 'segment-raised text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {Icon === undefined ? null : <Icon className="size-4" aria-hidden="true" />}
            {option.label}
            {option.count === undefined ? null : <Badge count={option.count} muted={!active} />}
          </button>
        );
      })}
    </div>
  );
}
