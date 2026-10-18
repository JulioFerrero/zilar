import {
  aiHealth,
  formatLimit,
  formatUsd,
  spendFraction,
  type AiHealthState,
} from '@zilar/chat-core';
import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { AiBadge } from '@/components/chat/ai-badge';
import { EntityAvatar } from '@/components/chat/entity-avatar';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

import type { PublicAi } from '../../lib/ais-api';

const HEALTH: Record<AiHealthState, { label: string; colour: string }> = {
  working: { label: 'Working', colour: 'bg-online' },
  failing: { label: 'Failing', colour: 'bg-danger' },
  paused: { label: 'Paused by its limit', colour: 'bg-[#f59e0b]' },
  stopped: { label: 'Stopped', colour: 'bg-subtle-foreground' },
};

const FIX_LABELS: Record<string, string> = {
  replace_key: 'Replace key',
  change_model: 'Change model',
};

export function AiRow({ ai, last, onPress }: { ai: PublicAi; last: boolean; onPress: () => void }) {
  const router = useRouter();
  const health = aiHealth(ai);
  const dot = HEALTH[health.state];
  const usage = ai.usage ?? null;
  const dailyLimit = ai.limits.perDayUsd;
  const fraction = spendFraction(ai);
  const full = usage !== null && dailyLimit !== null && usage.todayUsd >= dailyLimit;
  const fixLabel = health.fix === undefined ? undefined : FIX_LABELS[health.fix];

  const openFix = (): void => {
    if (health.fix === 'change_model') {
      router.push({ pathname: '/ais/[id]', params: { id: ai.id } });
      return;
    }
    router.push('/settings/connections');
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={ai.name}
      onPress={onPress}
      className={cn(
        'flex-row items-center gap-3 px-3.5 py-3 active:bg-list-hover',
        !last && 'border-b border-divider',
      )}
    >
      <View className="relative shrink-0">
        <EntityAvatar
          person={{ id: ai.jid, name: ai.name, avatarUrl: ai.avatarUrl }}
          size={40}
          ai
        />
        <View
          accessibilityRole="image"
          accessibilityLabel={dot.label}
          className={cn(
            'absolute right-0 bottom-0 size-3 rounded-full border-2 border-surface',
            dot.colour,
          )}
        />
      </View>
      <View className="min-w-0 flex-1 flex-col gap-[3px]">
        <View className="flex-row items-center gap-1.5">
          <Text numberOfLines={1} className="shrink text-[16px] font-semibold text-foreground">
            {ai.name}
          </Text>
          <AiBadge />
        </View>
        <Text numberOfLines={2} className="text-[14px] text-muted-foreground">
          {health.state === 'stopped' ? (
            `Stopped · ${ai.model}`
          ) : health.state === 'failing' ? (
            <>
              <Text className="text-danger">{health.reason}</Text>
              {fixLabel === undefined ? (
                ` · ${ai.model}`
              ) : (
                <>
                  {' · '}
                  <Text
                    accessibilityRole="link"
                    accessibilityLabel={fixLabel}
                    onPress={openFix}
                    className="text-accent underline"
                  >
                    {fixLabel}
                  </Text>
                </>
              )}
            </>
          ) : health.state === 'paused' ? (
            <>
              <Text className="text-[#f59e0b]">Daily limit reached</Text>
              {` · ${ai.model}`}
            </>
          ) : (
            ai.model
          )}
        </Text>
      </View>
      <View className="w-24 shrink-0 flex-col items-end gap-[5px]">
        {usage === null ? (
          <Text className="font-mono text-[12px] text-muted-foreground">—</Text>
        ) : dailyLimit === null ? (
          <Text className="font-mono text-[12px] text-foreground">{formatUsd(usage.todayUsd)}</Text>
        ) : (
          <>
            <Text className="font-mono text-[12px] text-foreground">
              {formatUsd(usage.todayUsd)}
              <Text className="text-subtle-foreground">{` / ${formatLimit(dailyLimit)}`}</Text>
            </Text>
            <View className="h-1 w-[72px] overflow-hidden rounded-[2px] bg-well">
              <View
                className={cn('h-full', full ? 'bg-[#f59e0b]' : 'bg-foreground')}
                style={{ width: `${(fraction ?? 0) * 100}%` }}
              />
            </View>
          </>
        )}
      </View>
    </Pressable>
  );
}
