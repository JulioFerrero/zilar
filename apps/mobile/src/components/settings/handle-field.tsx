import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';

import { handleAvailabilityText, type HandleAvailability } from './profile-logic';

type HandleFieldProps = {
  value: string;
  /** Your own handle, used to skip the live check against yourself. */
  current: string;
  availability: HandleAvailability;
  error?: string | undefined;
  saved: boolean;
  busy: boolean;
  saveDisabled: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
};

/**
 * The `@username` editor: the input, the debounced live-availability line,
 * the claim error, the saved confirmation, and the Save key. The screen
 * owns the check timing; this only renders.
 */
export function HandleField({
  value,
  availability,
  error,
  saved,
  busy,
  saveDisabled,
  onChange,
  onSave,
}: HandleFieldProps) {
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
      {saved ? <Text className="text-[14px] text-muted-foreground">Saved.</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Save username"
        disabled={busy || saveDisabled}
        onPress={onSave}
        className="mt-1 items-center self-start rounded-full bg-accent px-4 py-2 active:opacity-90 disabled:opacity-60"
      >
        <Text className="text-[14px] font-medium text-accent-foreground">
          {busy ? 'Saving…' : 'Save username'}
        </Text>
      </Pressable>
    </View>
  );
}
