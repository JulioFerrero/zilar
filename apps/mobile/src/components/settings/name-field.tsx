import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';

type NameFieldProps = {
  value: string;
  error?: string | undefined;
  busy: boolean;
  onChange: (value: string) => void;
};

export function NameField({ value, error, busy, onChange }: NameFieldProps) {
  return (
    <View className="gap-2 rounded-xl border border-border bg-surface px-3 py-2.5">
      <Text className="text-[16px] font-semibold text-foreground">Display name</Text>
      <TextField
        accessibilityLabel="Display name"
        maxLength={64}
        editable={!busy}
        value={value}
        onChangeText={onChange}
        placeholder="Your name"
        className="mt-1"
      />
      {error !== undefined ? (
        <Text accessibilityRole="alert" className="text-[14px] text-danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
