import { parseInviteCode } from '@zilar/chat-core';
import { TextField } from '@/components/ui/text-field';

export { parseInviteCode };

export function InviteCodeField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <TextField
      label="Invite code"
      accessibilityLabel="Invite code"
      autoCapitalize="none"
      autoComplete="off"
      autoCorrect={false}
      spellCheck={false}
      value={value}
      onChangeText={(text) => onChange(parseInviteCode(text))}
      placeholder="Paste your invite code or link"
    />
  );
}
