import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

import type { AiTemplate } from '../../lib/ais-api';
import { AI_TEMPLATE_OPTIONS } from './templates';

/** The four template cards of wizard step 1, two per row. */
export function TemplateCards({
  value,
  onChange,
}: {
  value: AiTemplate;
  onChange: (template: AiTemplate) => void;
}) {
  return (
    <View className="flex-row flex-wrap justify-between gap-y-2">
      {AI_TEMPLATE_OPTIONS.map((option) => {
        const selected = option.id === value;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.id)}
            className={cn(
              'w-[48%] rounded-xl border px-3 py-3 active:opacity-80',
              selected ? 'border-accent bg-accent/10' : 'border-divider bg-background',
            )}
          >
            <Text className="text-[16px] font-semibold text-foreground">{option.label}</Text>
            <Text className="mt-1 text-[13px] leading-4 text-muted-foreground">
              {option.description}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
