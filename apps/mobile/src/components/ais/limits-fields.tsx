import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';

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
