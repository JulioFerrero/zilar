import { TextField } from '@/components/ui/text-field';

/**
 * A pasted invite link `…/invite/<code>` is reduced to its code; anything else
 * (a bare code, with any surrounding whitespace) is kept as typed.
 */
export function parseInviteCode(raw: string): string {
  const trimmed = raw.trim();
  const match = /\/invite\/([^/?#\s]+)/.exec(trimmed);
  return match?.[1] ?? trimmed;
}

/** The sign-up invite code: accepts a bare code or a pasted invite link. */
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
