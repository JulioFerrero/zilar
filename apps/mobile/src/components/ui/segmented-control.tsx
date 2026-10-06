import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { segment, well } from '@/lib/depth';
import { cn } from '@/lib/utils';

export interface SegmentedOption {
  value: string;
  label: string;
}

export interface SegmentedControlProps {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  accessibilityLabel: string;
  mode?: 'tabs' | 'radio';
  /** Extra classes for the well track. */
  className?: string;
}

/**
 * The mobile kit segmented control: a recessed well track with the active
 * segment raised (`ui-style.md` §5). Exactly one option is selected; the track
 * carries the `tablist` or `radiogroup` role and each option the matching one.
 * The option `key` carries the selected state on purpose, so the raised style
 * re-applies when the selection toggles (the Stickers tabs trick).
 */
export function SegmentedControl({
  options,
  value,
  onChange,
  accessibilityLabel,
  mode = 'tabs',
  className,
}: SegmentedControlProps) {
  const isRadio = mode === 'radio';
  return (
    <View
      accessibilityRole={isRadio ? 'radiogroup' : 'tablist'}
      accessibilityLabel={accessibilityLabel}
      className={cn('flex-row gap-0.5 rounded-[10px] p-[3px]', className)}
      style={[well, { borderColor: '#1a1a1a' }]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={`${option.value}-${selected ? 'on' : 'off'}`}
            accessibilityRole={isRadio ? 'radio' : 'tab'}
            accessibilityState={isRadio ? { checked: selected } : { selected }}
            accessibilityLabel={option.label}
            onPress={() => {
              if (!selected) {
                onChange(option.value);
              }
            }}
            className="h-[34px] flex-1 items-center justify-center rounded-[7px]"
            style={selected ? segment : undefined}
          >
            <Text
              className={cn(
                'text-[13px] font-medium',
                selected ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
