import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';

import { handleAvailabilityText, type HandleAvailability } from './profile-logic';

type HandleFieldProps = {
  value: string;
  availability: HandleAvailability;
  error?: string | undefined;
  busy: boolean;
  onChange: (value: string) => void;
};

export function HandleField({ value, availability, error, busy, onChange }: HandleFieldProps) {
  const line = handleAvailabilityText(availability);
  const unavailable = availability.state === 'unavailable';
  return (
    <View className="gap-2 rounded-xl border border-border bg-surface px-3 py-2.5">
      <Text className="text-[14px] font-medium text-foreground">Your @username</Text>
      <TextField
        accessibilityLabel="Your username"
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        maxLength={32}
        editable={!busy}
        value={value}
        onChangeText={onChange}
        placeholder="ada_lovelace"
        className="mt-1"
      />
      <View accessibilityLiveRegion="polite" className="min-h-[20px]">
        {line !== null ? (
          <Text
            className={
              unavailable ? 'text-[14px] text-danger' : 'text-[14px] text-muted-foreground'
            }
          >
            {line}
          </Text>
        ) : null}
      </View>
      {error !== undefined ? (
        <Text accessibilityRole="alert" className="text-[14px] text-danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
