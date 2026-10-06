import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';

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
  const suggestions = modelSuggestionsFor(provider);
  return (
    <View className="gap-3">
      <View className="gap-1">
        <Text className="text-[14px] font-medium text-foreground">Model</Text>
        <TextField
          value={value}
          onChangeText={onChange}
          accessibilityLabel="Model"
          placeholder={`${providerLabel(provider)} model name`}
          maxLength={256}
          autoCapitalize="none"
          autoCorrect={false}
          className="py-2.5"
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
