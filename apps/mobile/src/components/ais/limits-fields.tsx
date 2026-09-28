import { TextInput, View } from 'react-native';
import { useColorScheme } from 'nativewind';

import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { MUTED_FOREGROUND } from '@/lib/colors';

function AmountField({
  label,
  accessibilityLabel,
  value,
  placeholder,
  error,
  onChange,
}: {
  label: string;
  accessibilityLabel: string;
  value: string;
  placeholder: string;
  error: string;
  onChange: (value: string) => void;
}) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  return (
    <View className="gap-1">
      <Text className="text-[14px] font-medium text-foreground">{label}</Text>
      <View className="flex-row items-center gap-2">
        <Text className="text-[15px] text-muted-foreground">$</Text>
        <TextInput
          value={value}
          onChangeText={onChange}
          accessibilityLabel={accessibilityLabel}
          keyboardType="decimal-pad"
          placeholder={placeholder}
          placeholderTextColor={MUTED_FOREGROUND[scheme]}
          className="w-32 rounded-lg border border-input bg-background px-3 py-2.5 text-[15px] text-foreground"
        />
      </View>
      {error !== '' ? (
        <Text accessibilityRole="alert" className="text-[13px] text-danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** Wizard step 5: the USD daily and monthly caps, with the server's rules. */
export function LimitsFields({
  day,
  month,
  dayError,
  monthError,
  onDayChange,
  onMonthChange,
}: {
  day: string;
  month: string;
  dayError: string;
  monthError: string;
  onDayChange: (value: string) => void;
  onMonthChange: (value: string) => void;
}) {
  return (
    <View className="gap-3">
      <AmountField
        label="Per day (USD)"
        accessibilityLabel="Per day amount"
        value={day}
        placeholder="2"
        error={dayError}
        onChange={onDayChange}
      />
      <AmountField
        label="Per month (USD)"
        accessibilityLabel="Per month amount"
        value={month}
        placeholder="20"
        error={monthError}
        onChange={onMonthChange}
      />
      <Text className="text-[13px] text-muted-foreground">
        Amounts are in USD. The monthly cap is what the AI's provider key can spend.
      </Text>
    </View>
  );
}
