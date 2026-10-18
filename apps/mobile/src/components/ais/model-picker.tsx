import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Wrench } from 'lucide-react-native';
import type { AiCatalogModel } from '@zilar/api-contract';

import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { ACCENT } from '@/lib/colors';

import { OptionRow } from './option-row';
import { formatContextTokens, formatModelPrices, modelSuggestionsFor } from './models';
import { providerLabel } from './providers';

export function ModelPicker({
  provider,
  value,
  onChange,
  models = [],
}: {
  provider: string;
  value: string;
  onChange: (model: string) => void;
  models?: readonly AiCatalogModel[];
}) {
  const [query, setQuery] = useState('');
  const suggestions = modelSuggestionsFor(provider);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (term === '') {
      return models;
    }
    return models.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(term));
  }, [models, query]);

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

      {models.length > 0 ? (
        <View className="gap-2">
          <TextField
            value={query}
            onChangeText={setQuery}
            accessibilityLabel="Search models"
            placeholder="Search models"
            maxLength={64}
            autoCapitalize="none"
            autoCorrect={false}
            className="py-2.5"
          />
          {filtered.length === 0 ? (
            <Text className="text-[13px] text-muted-foreground">No models match your search.</Text>
          ) : (
            filtered.map((model) => (
              <OptionRow
                key={model.id}
                selected={value === model.id}
                accessibilityLabel={model.name}
                onPress={() => onChange(model.id)}
                className="py-2.5"
              >
                <View className="min-w-0 flex-1 gap-0.5">
                  <Text className="text-[15px] text-foreground">{model.name}</Text>
                  <Text className="text-[12px] text-muted-foreground">
                    {formatContextTokens(model.contextTokens)} ·{' '}
                    {formatModelPrices(model.inputPricePerMTok, model.outputPricePerMTok)}
                  </Text>
                </View>
                {model.toolCalls ? (
                  <View className="flex-row items-center gap-1 rounded-full border border-divider px-1.5 py-0.5">
                    <Wrench size={11} color={ACCENT} />
                    <Text className="text-[11px] text-muted-foreground">tools</Text>
                  </View>
                ) : null}
              </OptionRow>
            ))
          )}
        </View>
      ) : suggestions.length > 0 ? (
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
      ) : null}
    </View>
  );
}
