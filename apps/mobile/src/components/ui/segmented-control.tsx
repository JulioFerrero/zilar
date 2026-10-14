import type { LucideIcon } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { FOREGROUND, MUTED_FOREGROUND } from '@/lib/colors';
import { ACCENT_FOREGROUND, primaryKey, segment, well } from '@/lib/depth';
import { cn } from '@/lib/utils';

export interface SegmentedOption {
  value: string;
  label: string;
  /** An optional lucide icon, drawn at 15 px inline with the label. */
  icon?: LucideIcon;
}

export interface SegmentedControlProps {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  accessibilityLabel: string;
  mode?: 'tabs' | 'radio';
  /**
   * `tab` is the default: the active option is the dark raised segment.
   * `choice` is the New AI look: the selected option is the light primary key
   * with dark text, a 40 px row, and every option keeps the same weight.
   */
  tone?: 'tab' | 'choice';
  /** Extra classes for the well track. */
  className?: string;
}

/**
 * The mobile kit segmented control: a recessed well track with the active
 * segment raised (`ui-style.md` §5). Exactly one option is selected; the track
 * carries the `tablist` or `radiogroup` role and each option the matching one.
 * The option `key` carries the selected state on purpose, so the raised style
 * re-applies when the selection toggles (the Stickers tabs trick). With
 * `tone="choice"` the selected option is the light primary key instead
 * (`PhoneSetup.dc.html`), a 40 px row at 13/500 that can carry an inline icon.
 */
export function SegmentedControl({
  options,
  value,
  onChange,
  accessibilityLabel,
  mode = 'tabs',
  tone = 'tab',
  className,
}: SegmentedControlProps) {
  const isRadio = mode === 'radio';
  const isChoice = tone === 'choice';
  return (
    <View
      accessibilityRole={isRadio ? 'radiogroup' : 'tablist'}
      accessibilityLabel={accessibilityLabel}
      className={cn('flex-row gap-0.5 rounded-[10px] p-[3px]', className)}
      style={[well, { borderColor: '#1a1a1a' }]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const Icon = option.icon;
        const labelTone = selected
          ? isChoice
            ? 'text-accent-foreground'
            : 'text-foreground'
          : 'text-muted-foreground';
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
            className={cn(
              'flex-1 flex-row items-center justify-center gap-1.5 rounded-[7px]',
              isChoice ? 'h-10' : 'h-[34px]',
            )}
            style={selected ? (isChoice ? primaryKey : segment) : undefined}
          >
            {Icon === undefined ? null : (
              <Icon
                size={15}
                color={selected ? (isChoice ? ACCENT_FOREGROUND : FOREGROUND) : MUTED_FOREGROUND}
              />
            )}
            <Text className={cn('text-[13px] font-medium', labelTone)}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
