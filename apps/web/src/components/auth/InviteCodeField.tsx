import { parseInviteCode } from '@zilar/chat-core';
import { TextInput } from '@/components/ui/text-input';

export { parseInviteCode };

export function InviteCodeField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <TextInput
      id="auth-invite-code"
      label="Invite code"
      value={value}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="none"
      spellCheck={false}
      placeholder="Paste your invite code or link"
      onChange={(event) => onChange(parseInviteCode(event.target.value))}
    />
  );
}
