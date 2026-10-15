import { View } from 'react-native';

import { SelectSheet, type SelectSheetOption } from '@/components/ui/select-sheet';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';

import type { KeyCheck } from '@/components/connections/use-key-check';

/**
 * Step 1 (Mobile.dc.html and PhoneCompatible.dc.html): the provider list, with
 * a green dot on a provider that already has a key. OpenAI-compatible is pinned
 * under the list; picking it reveals Base URL (with a green dot once the key
 * checks out) and Name. Shared by the New AI flow and the Add key sheet.
 */
export function ProviderStep({ keys }: { keys: KeyCheck }) {
  const options: SelectSheetOption[] = keys.providerChoices
    .filter((choice) => choice.id !== 'openai-compatible')
    .map((choice) => ({
      value: choice.id,
      label: choice.label,
      ...(choice.hasKey ? { dot: 'online' as const } : {}),
    }));

  return (
    <View className="gap-4">
      <View className="gap-1">
        <Text className="text-[13px] font-medium text-foreground">Provider</Text>
        <SelectSheet
          label="Provider"
          value={keys.providerId}
          options={options}
          onChange={keys.selectProvider}
          searchPlaceholder="Filter providers"
          footerOption={{
            label: 'OpenAI-compatible',
            value: 'openai-compatible',
            onPress: () => keys.selectProvider('openai-compatible'),
          }}
        />
      </View>

      {keys.isCompatible ? (
        <>
          <View className="gap-1">
            <Text className="text-[13px] font-medium text-foreground">Base URL</Text>
            <View className="flex-row items-center gap-2">
              <TextField
                value={keys.baseUrl}
                onChangeText={keys.setBaseUrl}
                accessibilityLabel="Base URL"
                placeholder="https://api.example.com/v1"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={300}
                className="min-w-0 flex-1"
              />
              {keys.keyVerified ? <View className="h-2 w-2 rounded-full bg-online" /> : null}
            </View>
          </View>
          <View className="gap-1">
            <Text className="text-[13px] font-medium text-foreground">Name</Text>
            <TextField
              value={keys.connectionName}
              onChangeText={keys.setConnectionName}
              accessibilityLabel="Name"
              placeholder="Together"
              maxLength={256}
            />
          </View>
        </>
      ) : null}

      {keys.providerError !== '' ? (
        <Text accessibilityRole="alert" className="text-[13px] text-danger">
          {keys.providerError}
        </Text>
      ) : null}
    </View>
  );
}
