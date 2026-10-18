import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';

type BioFieldProps = {
  value: string;
  error?: string | undefined;
  busy: boolean;
  onChange: (value: string) => void;
};

export function BioField({ value, error, busy, onChange }: BioFieldProps) {
  return (
    <View className="gap-2 rounded-xl border border-border bg-surface px-3 py-2.5">
      <Text className="text-[16px] font-semibold text-foreground">Bio</Text>
      <TextField
        accessibilityLabel="Bio"
        maxLength={140}
        editable={!busy}
        value={value}
        onChangeText={(next) => onChange(next.replace(/[\r\n]+/g, ''))}
        placeholder="A few words about you"
        className="mt-1"
      />
      <View className="flex-row items-start justify-between gap-2">
        <Text className="flex-1 text-[13px] text-muted-foreground">
          A few words about you. Anyone who finds you by username can see it.
        </Text>
        <Text className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
          {value.length} / 140
        </Text>
      </View>
      {error !== undefined ? (
        <Text accessibilityRole="alert" className="text-[14px] text-danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
