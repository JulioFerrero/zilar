import { ChevronRight } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { useColorScheme } from 'nativewind';

import { AiBadge } from '@/components/chat/ai-badge';
import { Avatar } from '@/components/chat/avatar';
import { Text } from '@/components/ui/text';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { asColorScheme } from '@/lib/color-scheme';
import { cn } from '@/lib/utils';

import type { PublicAi } from '../../lib/ais-api';
import { formatLimit } from './limits';
import { templateLabel } from './templates';

/** One row of the My AIs list: avatar, name, template, model and limits. */
export function AiRow({
  ai,
  highlighted,
  onPress,
}: {
  ai: PublicAi;
  highlighted: boolean;
  onPress: () => void;
}) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={ai.name}
      onPress={onPress}
      className={cn(
        'flex-row items-center gap-3 rounded-xl border px-3 py-2.5 active:bg-list-hover',
        highlighted ? 'border-accent bg-surface-raised' : 'border-transparent',
      )}
    >
      <Avatar id={ai.id} name={ai.name} size={44} ai />
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-1.5">
          <Text numberOfLines={1} className="shrink text-[16px] font-semibold text-foreground">
            {ai.name}
          </Text>
          <AiBadge />
          {ai.status !== 'active' ? (
            <View className="rounded-full bg-badge-muted px-2 py-0.5">
              <Text className="text-[11px] text-foreground">{ai.status}</Text>
            </View>
          ) : null}
        </View>
        <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
          {templateLabel(ai.template)} · {ai.model}
        </Text>
        <Text className="text-[13px] text-muted-foreground">
          {formatLimit(ai.limits.perDayUsd)}/day · {formatLimit(ai.limits.perMonthUsd)}/month
        </Text>
      </View>
      <ChevronRight size={20} color={MUTED_FOREGROUND[scheme]} />
    </Pressable>
  );
}
