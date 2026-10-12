import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';

type BioFieldProps = {
  value: string;
  error?: string | undefined;
  saved: boolean;
  busy: boolean;
  /** True while the trimmed bio equals the saved one, so Save stays disabled. */
  unchanged: boolean;
  /**
   * True while another save (the name) is in flight. The bio PATCH carries the
   * saved name, so it must wait: sending it during a name save would revert the
   * rename that the name save is still landing.
   */
  saveDisabled: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
};

/**
 * The bio editor (T-1259): a single-line input with a `n / 140` counter and the
 * same hint as web. The screen owns the save timing; this only renders. New
 * lines are stripped as they are typed, so the value stays on one line like the
 * server's `AuthBio`.
 */
export function BioField({
  value,
  error,
  saved,
  busy,
  unchanged,
  saveDisabled,
  onChange,
  onSave,
}: BioFieldProps) {
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
      {saved ? <Text className="text-[14px] text-muted-foreground">Saved.</Text> : null}
      <Button
        variant="default"
        size="sm"
        className="mt-1 self-start"
        accessibilityLabel="Save bio"
        disabled={busy || unchanged || saveDisabled}
        onPress={onSave}
      >
        <Text>{busy ? 'Saving…' : 'Save bio'}</Text>
      </Button>
    </View>
  );
}
