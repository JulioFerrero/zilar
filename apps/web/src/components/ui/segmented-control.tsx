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
  /** Rendered muted and not selectable; arrow keys skip it. */
  disabled?: boolean;
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

  const firstEnabled = (): number | undefined => {
    const index = options.findIndex((option) => option.disabled !== true);
    return index === -1 ? undefined : index;
  };

  const lastEnabled = (): number | undefined => {
    for (let index = options.length - 1; index >= 0; index -= 1) {
      if (options[index]?.disabled !== true) {
        return index;
      }
    }
    return undefined;
  };

  /** The next enabled option from `from` in `direction`, wrapping once. */
  const enabledFrom = (from: number, direction: 1 | -1): number | undefined => {
    const last = options.length - 1;
    let index = from;
    for (let step = 0; step < options.length; step += 1) {
      index = direction === 1 ? (index >= last ? 0 : index + 1) : index <= 0 ? last : index - 1;
      if (options[index]?.disabled !== true) {
        return index;
      }
    }
    return undefined;
  };

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let next: number | undefined;
    if (event.key === 'ArrowRight') {
      next = enabledFrom(index, 1);
    } else if (event.key === 'ArrowLeft') {
      next = enabledFrom(index, -1);
    } else if (event.key === 'Home') {
      next = firstEnabled();
    } else if (event.key === 'End') {
      next = lastEnabled();
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
        const disabled = option.disabled === true;
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
            {...(disabled ? { 'aria-disabled': true } : {})}
            disabled={disabled}
            tabIndex={disabled ? -1 : active ? 0 : -1}
            onClick={() => {
              if (!disabled && option.value !== value) {
                onChange(option.value);
              }
            }}
            onKeyDown={(event) => move(event, index)}
            className={cn(
              'flex flex-1 items-center justify-center font-medium transition-colors',
              isChoice
                ? 'h-[34px] gap-[7px] rounded-[7px] px-3 text-[13px] leading-none'
                : 'h-[30px] gap-1.5 rounded-[7px] px-3 text-[13px]',
              disabled
                ? 'text-subtle-foreground opacity-50'
                : active
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
