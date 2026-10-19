import type { LucideIcon } from 'lucide-react';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { Tabs } from '@base-ui/react/tabs';
import { Badge } from './badge';
import { cn } from '@/lib/utils';

export interface SegmentedOption {
  value: string;
  label: string;
  count?: number;
  icon?: LucideIcon;
  disabled?: boolean;
}

export interface SegmentedControlProps {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  mode?: 'tabs' | 'radio';
  tone?: 'tab' | 'choice';
}

export function SegmentedControl({
  options,
  value,
  onChange,
  ariaLabel,
  mode = 'tabs',
  tone = 'tab',
}: SegmentedControlProps) {
  const isRadio = mode === 'radio';
  const isChoice = tone === 'choice';

  const itemClassName = cn(
    'flex flex-1 items-center justify-center font-medium transition-colors',
    isChoice
      ? 'h-[34px] gap-[7px] rounded-[7px] px-3 text-[13px] leading-none'
      : 'h-[30px] gap-1.5 rounded-[7px] px-3 text-[13px]',
    isChoice
      ? 'text-muted-foreground hover:text-foreground data-[checked]:segment-choice data-[active]:segment-choice'
      : 'text-muted-foreground hover:text-foreground data-[checked]:segment-raised data-[checked]:text-foreground data-[active]:segment-raised data-[active]:text-foreground',
    'data-[disabled]:text-subtle-foreground data-[disabled]:opacity-50',
  );

  const trackClassName = cn(
    'well-surface flex rounded-[10px] p-[3px]',
    isChoice ? 'gap-0.5' : 'gap-1',
  );

  return isRadio ? (
    <RadioGroup
      value={value}
      onValueChange={(next: string) => {
        if (next !== value) {
          onChange(next);
        }
      }}
      aria-label={ariaLabel}
      className={trackClassName}
    >
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <Radio.Root
            key={option.value}
            value={option.value}
            disabled={option.disabled === true}
            className={itemClassName}
          >
            {Icon === undefined ? null : <Icon className="size-4" aria-hidden="true" />}
            {option.label}
            {option.count === undefined ? null : <Badge count={option.count} muted={!active} />}
          </Radio.Root>
        );
      })}
    </RadioGroup>
  ) : (
    <Tabs.Root
      value={value}
      onValueChange={(next) => {
        if (typeof next === 'string' && next !== value) {
          onChange(next);
        }
      }}
      className="contents"
    >
      <Tabs.List aria-label={ariaLabel} activateOnFocus className={trackClassName}>
        {options.map((option) => {
          const active = option.value === value;
          const Icon = option.icon;
          return (
            <Tabs.Tab
              key={option.value}
              value={option.value}
              disabled={option.disabled === true}
              className={itemClassName}
            >
              {Icon === undefined ? null : <Icon className="size-4" aria-hidden="true" />}
              {option.label}
              {option.count === undefined ? null : <Badge count={option.count} muted={!active} />}
            </Tabs.Tab>
          );
        })}
      </Tabs.List>
    </Tabs.Root>
  );
}
