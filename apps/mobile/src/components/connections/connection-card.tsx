import { Trash2, Zap } from 'lucide-react-native';
import { View } from 'react-native';

import { providerLabel } from '@/components/ais/providers';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';
import type { ProviderConnection } from '@/lib/connections-api';

/**
 * One provider row, either the normal view with Test / Remove or the inline
 * confirm that replaces it. The parent keys it by connection id.
 */
export function ConnectionCard({
  connection,
  confirming,
  removeError,
  busy,
  testing,
  works,
  testError,
  onCancelRemove,
  onConfirmRemove,
  onTest,
  onAskRemove,
}: {
  connection: ProviderConnection;
  confirming: boolean;
  removeError: string;
  busy: boolean;
  testing: boolean;
  works: boolean;
  testError: string | undefined;
  onCancelRemove: () => void;
  onConfirmRemove: () => void;
  onTest: () => void;
  onAskRemove: () => void;
}) {
  if (confirming) {
    return (
      <View className="gap-2 px-3 py-2.5">
        <Text className="text-[15px] font-medium text-foreground">
          Remove {providerLabel(connection.provider)}?
        </Text>
        {removeError !== '' ? (
          <Text accessibilityRole="alert" className="text-[13px] text-danger">
            {removeError}
          </Text>
        ) : null}
        <View className="flex-row justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            accessibilityLabel="Cancel removing"
            disabled={busy}
            onPress={onCancelRemove}
          >
            <Text>Cancel</Text>
          </Button>
          <Button
            variant="destructive"
            size="sm"
            accessibilityLabel="Confirm remove"
            disabled={busy}
            onPress={onConfirmRemove}
          >
            <Text>{busy ? 'Removing…' : 'Remove'}</Text>
          </Button>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-row items-center gap-3 px-3 py-2.5">
      <View className="min-w-0 flex-1">
        <View className="flex-row flex-wrap items-center gap-2">
          <Text className="text-[15px] font-medium text-foreground">
            {providerLabel(connection.provider)}
          </Text>
          <Text className="rounded-full bg-surface-raised px-2 py-0.5 text-[11px] text-foreground">
            {connection.status}
          </Text>
        </View>
        <Text numberOfLines={1} className="mt-0.5 text-[13px] text-muted-foreground">
          {connection.label ?? 'No label'}
        </Text>
        {works ? <Text className="text-[13px] text-online">Key works</Text> : null}
        {testError !== undefined ? (
          <Text accessibilityRole="alert" className="text-[13px] text-danger">
            {testError}
          </Text>
        ) : null}
      </View>
      <View className="flex-row shrink-0 gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full"
          accessibilityLabel={`Test ${providerLabel(connection.provider)} key`}
          disabled={testing}
          onPress={onTest}
        >
          <Zap size={16} color={ICON} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full"
          accessibilityLabel={`Remove ${providerLabel(connection.provider)} connection`}
          onPress={onAskRemove}
        >
          <Trash2 size={16} color={ICON} />
        </Button>
      </View>
    </View>
  );
}
