import { TextInput, View } from 'react-native';
import { useColorScheme } from 'nativewind';

import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { MUTED_FOREGROUND } from '@/lib/colors';

import { OptionRow } from './option-row';
import { modelSuggestionsFor } from './models';
import { providerLabel } from './providers';

/** The wizard's model picker: a free-text field plus tappable per-provider hints. */
export function ModelPicker({
  provider,
  value,
  onChange,
}: {
  provider: string;
  value: string;
  onChange: (model: string) => void;
}) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const suggestions = modelSuggestionsFor(provider);
  return (
    <View className="gap-3">
      <View className="gap-1">
        <Text className="text-[14px] font-medium text-foreground">Model</Text>
        <TextInput
          value={value}
          onChangeText={onChange}
          accessibilityLabel="Model"
          placeholder={`${providerLabel(provider)} model name`}
          placeholderTextColor={MUTED_FOREGROUND[scheme]}
          maxLength={256}
          autoCapitalize="none"
          autoCorrect={false}
          className="rounded-lg border border-input bg-background px-3 py-2.5 text-[15px] text-foreground"
        />
      </View>

      {suggestions.length > 0 && (
        <View className="gap-2">
          <Text className="text-[13px] text-muted-foreground">Suggestions</Text>
          {suggestions.map((model) => (
            <OptionRow
              key={model}
              selected={value === model}
              accessibilityLabel={model}
              onPress={() => onChange(model)}
              className="py-2.5"
            >
              <Text className="text-[15px] text-foreground">{model}</Text>
            </OptionRow>
          ))}
        </View>
      )}
    </View>
  );
}
