import { ChevronRight } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { AiBadge } from '@/components/chat/ai-badge';
import { EntityAvatar } from '@/components/chat/entity-avatar';
import { Text } from '@/components/ui/text';
import { MUTED_FOREGROUND } from '@/lib/colors';

import type { PublicAi } from '../../lib/ais-api';
import { formatLimits } from './limits';
import { runStateLabel } from './run-state';
import { templateLabel } from './templates';

/** One row of the My AIs list: avatar, name, template, model and limits. */
export function AiRow({ ai, onPress }: { ai: PublicAi; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={ai.name}
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 active:bg-list-hover"
    >
      <EntityAvatar person={{ id: ai.jid, name: ai.name, avatarUrl: ai.avatarUrl }} size={44} ai />
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-1.5">
          <Text numberOfLines={1} className="shrink text-[16px] font-semibold text-foreground">
            {ai.name}
          </Text>
          <AiBadge />
          {runStateLabel(ai.status) !== '' ? (
            <View
              accessibilityLabel={`AI status: ${runStateLabel(ai.status)}`}
              className="rounded-full bg-badge-muted px-2 py-0.5"
            >
              <Text className="text-[11px] text-foreground">{runStateLabel(ai.status)}</Text>
            </View>
          ) : null}
        </View>
        <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
          {templateLabel(ai.template)} · {ai.model}
        </Text>
        <Text className="text-[13px] text-muted-foreground">{formatLimits(ai.limits)}</Text>
      </View>
      <ChevronRight size={20} color={MUTED_FOREGROUND} />
    </Pressable>
  );
}
