import { palette } from '@zilar/ui-tokens';
import { Check, KeyRound, Trash2, Zap } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { providerLabel } from '@/components/ais/providers';
import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import type { ProviderConnection } from '@/lib/connections-api';
import { cn } from '@/lib/utils';

export function ConnectionSheet({
  connection,
  working,
  tested,
  testing,
  replacing,
  replaceError,
  onClose,
  onDismissed,
  onTest,
  onReplaceStart,
  onReplace,
  onDelete,
}: {
  connection: ProviderConnection | null;
  working: boolean;
  tested: boolean;
  testing: boolean;
  replacing: boolean;
  replaceError: string;
  onClose: () => void;
  onDismissed: () => void;
  onTest: () => void;
  onReplaceStart: () => void;
  onReplace: (key: string) => void;
  onDelete: () => void;
}) {
  const [replacingKey, setReplacingKey] = useState(false);
  const [key, setKey] = useState('');

  const label = connection === null ? '' : providerLabel(connection.provider);

  const openReplace = (): void => {
    onReplaceStart();
    setReplacingKey(true);
  };

  const cancelReplace = (): void => {
    onReplaceStart();
    setReplacingKey(false);
  };

  const save = (): void => {
    const trimmed = key.trim();
    if (trimmed !== '') {
      onReplace(trimmed);
    }
  };

  return (
    <ActionSheet
      visible={connection !== null}
      onClose={onClose}
      onDismissed={onDismissed}
      closeLabel="Close key actions"
      error={replaceError}
      header={
        connection === null ? undefined : (
          <View className="flex-row items-center gap-2.5 px-4 py-3">
            <View
              accessibilityRole="image"
              accessibilityLabel={working ? 'Working' : 'Not working'}
              className={cn('h-2 w-2 shrink-0 rounded-full', working ? 'bg-online' : 'bg-danger')}
            />
            <Text
              numberOfLines={1}
              className="min-w-0 flex-1 text-[17px] font-semibold text-foreground"
            >
              {label}
            </Text>
          </View>
        )
      }
    >
      {replacingKey
        ? [
            <View key="replace-form" className="gap-3 px-4 py-3">
              <TextField
                label="New API key"
                value={key}
                onChangeText={setKey}
                placeholder="sk-…"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                maxLength={16384}
              />
              <View className="flex-row justify-end gap-2">
                <Button variant="ghost" size="sm" disabled={replacing} onPress={cancelReplace}>
                  <Text>Cancel</Text>
                </Button>
                <Button
                  size="sm"
                  disabled={replacing || key.trim() === ''}
                  onPress={save}
                  accessibilityLabel={`Save ${label} key`}
                >
                  <Text>{replacing ? 'Saving…' : 'Save'}</Text>
                </Button>
              </View>
            </View>,
          ]
        : [
            <View key="test" className="flex-row items-center">
              <View className="min-w-0 flex-1">
                <ActionSheetItem
                  label="Test key"
                  icon={Zap}
                  disabled={testing}
                  onPress={onTest}
                  accessibilityLabel={`Test ${label} key`}
                />
              </View>
              {tested ? (
                <View accessibilityRole="image" accessibilityLabel="Key works" className="pr-4">
                  <Check size={16} color={palette.online} />
                </View>
              ) : null}
            </View>,
            <ActionSheetItem
              key="replace"
              label="Replace key"
              icon={KeyRound}
              onPress={openReplace}
              accessibilityLabel={`Replace ${label} key`}
            />,
            <ActionSheetItem
              key="delete"
              label="Delete"
              icon={Trash2}
              destructive
              onPress={onDelete}
              accessibilityLabel={`Delete ${label} key`}
            />,
          ]}
    </ActionSheet>
  );
}
