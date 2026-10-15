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

/**
 * A connection's key action sheet (T-1516): the status dot and the provider
 * name, then Test key, Replace key and Delete. Test shows a green check once
 * this screen's last test passed; Replace swaps the items for a secure key
 * field with Save and Cancel; Delete is destructive. The parent remounts it on
 * every open, so it always starts on the menu with no draft key.
 */
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
  /** The dot's state: active and no failed test in this screen. */
  working: boolean;
  /** True once this screen's last test for the connection passed. */
  tested: boolean;
  /** True while a test for the connection runs. */
  testing: boolean;
  /** True while the key replacement is in flight. */
  replacing: boolean;
  /** The last replacement failure, shown in the sheet's error slot. */
  replaceError: string;
  onClose: () => void;
  /** Fires after the sheet has fully closed, so a follow-up dialog is safe. */
  onDismissed: () => void;
  onTest: () => void;
  /** Clears the replacement failure when the form opens or cancels. */
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
