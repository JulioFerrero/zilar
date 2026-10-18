import { MoreHorizontal } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { providerLabel } from '@/components/ais/providers';
import { Text } from '@/components/ui/text';
import { MUTED_FOREGROUND } from '@/lib/colors';
import type { ProviderConnection } from '@/lib/connections-api';
import { cn } from '@/lib/utils';

/**
 * The host of a custom connection's base URL, e.g. `api.groq.com`. The server
 * stores a validated https URL, so a plain split is enough and never throws.
 */
function hostOf(baseUrl: string): string {
  const withoutScheme = baseUrl.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  return withoutScheme.split('/')[0] ?? baseUrl;
}

function addedDate(createdAt: string): string {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(
    new Date(createdAt),
  );
}

export function ConnectionRow({
  connection,
  working,
  reason,
  last,
  onPress,
}: {
  connection: ProviderConnection;
  working: boolean;
  reason: string | undefined;
  last: boolean;
  onPress: () => void;
}) {
  const label = providerLabel(connection.provider);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} key actions`}
      onPress={onPress}
      className={cn(
        'min-h-[64px] flex-row items-center gap-3 pl-4 pr-3 active:bg-list-hover',
        last ? undefined : 'border-b border-divider',
      )}
    >
      <View
        accessibilityRole="image"
        accessibilityLabel={working ? 'Working' : 'Not working'}
        className={cn('h-2 w-2 shrink-0 rounded-full', working ? 'bg-online' : 'bg-danger')}
      />
      <View className="min-w-0 flex-1">
        <Text className="text-[16px] font-semibold text-foreground">{label}</Text>
        <Text numberOfLines={1} className="text-[14px] text-muted-foreground">
          {reason !== undefined ? <Text className="text-danger">{reason}</Text> : null}
          {reason !== undefined ? ' · ' : ''}
          {connection.label !== null ? `${connection.label} · ` : ''}
          {connection.baseUrl !== null ? `${hostOf(connection.baseUrl)} · ` : ''}
          {addedDate(connection.createdAt)}
        </Text>
      </View>
      <MoreHorizontal size={18} color={MUTED_FOREGROUND} />
    </Pressable>
  );
}
