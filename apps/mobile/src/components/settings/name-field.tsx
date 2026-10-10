import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';

type NameFieldProps = {
  value: string;
  error?: string | undefined;
  saved: boolean;
  busy: boolean;
  /** True while the trimmed name equals the saved one, so Save stays disabled. */
  unchanged: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
};

/**
 * The display-name editor: the input, the save error, the saved confirmation,
 * and the Save key. The screen owns the save timing; this only renders.
 */
export function NameField({
  value,
  error,
  saved,
  busy,
  unchanged,
  onChange,
  onSave,
}: NameFieldProps) {
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
      {saved ? <Text className="text-[14px] text-muted-foreground">Saved.</Text> : null}
      <Button
        variant="default"
        size="sm"
        className="mt-1 self-start"
        accessibilityLabel="Save name"
        disabled={busy || unchanged}
        onPress={onSave}
      >
        <Text>{busy ? 'Saving…' : 'Save name'}</Text>
      </Button>
    </View>
  );
}
