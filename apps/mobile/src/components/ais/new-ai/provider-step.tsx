import { View } from 'react-native';

import { SelectSheet, type SelectSheetOption } from '@/components/ui/select-sheet';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';

import type { NewAiFlow } from './use-new-ai-flow';

/**
 * Step 1 (Mobile.dc.html and PhoneCompatible.dc.html): the provider list, with
 * a green dot on a provider that already has a key. OpenAI-compatible is pinned
 * under the list; picking it reveals Base URL (with a green dot once the key
 * checks out) and Name.
 */
export function ProviderStep({ flow }: { flow: NewAiFlow }) {
  const options: SelectSheetOption[] = flow.providerChoices
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
          value={flow.providerId}
          options={options}
          onChange={flow.selectProvider}
          searchPlaceholder="Filter providers"
          footerOption={{
            label: 'OpenAI-compatible',
            onPress: () => flow.selectProvider('openai-compatible'),
          }}
        />
      </View>

      {flow.isCompatible ? (
        <>
          <View className="gap-1">
            <Text className="text-[13px] font-medium text-foreground">Base URL</Text>
            <View className="flex-row items-center gap-2">
              <TextField
                value={flow.baseUrl}
                onChangeText={flow.setBaseUrl}
                accessibilityLabel="Base URL"
                placeholder="https://api.example.com/v1"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={300}
                className="min-w-0 flex-1"
              />
              {flow.keyVerified ? <View className="h-2 w-2 rounded-full bg-online" /> : null}
            </View>
          </View>
          <View className="gap-1">
            <Text className="text-[13px] font-medium text-foreground">Name</Text>
            <TextField
              value={flow.connectionName}
              onChangeText={flow.setConnectionName}
              accessibilityLabel="Name"
              placeholder="Together"
              maxLength={256}
            />
          </View>
        </>
      ) : null}

      {flow.providerError !== '' ? (
        <Text accessibilityRole="alert" className="text-[13px] text-danger">
          {flow.providerError}
        </Text>
      ) : null}
    </View>
  );
}
