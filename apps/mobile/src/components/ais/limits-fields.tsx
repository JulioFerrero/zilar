import { View } from 'react-native';

import { Text, TextField } from '@/components/ui/text';

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
  return (
    <View className="gap-1">
      <Text className="text-[14px] font-medium text-foreground">{label}</Text>
      <View className="flex-row items-center gap-2">
        <Text className="text-[15px] text-muted-foreground">$</Text>
        <TextField
          value={value}
          onChangeText={onChange}
          accessibilityLabel={accessibilityLabel}
          keyboardType="decimal-pad"
          placeholder={placeholder}
          className="w-32 py-2.5"
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
        placeholder="No limit"
        error={dayError}
        onChange={onDayChange}
      />
      <AmountField
        label="Per month (USD)"
        accessibilityLabel="Per month amount"
        value={month}
        placeholder="No limit"
        error={monthError}
        onChange={onMonthChange}
      />
      <Text className="text-[13px] text-muted-foreground">
        Optional. Leave empty for no limit. Amounts are in USD.
      </Text>
    </View>
  );
}
