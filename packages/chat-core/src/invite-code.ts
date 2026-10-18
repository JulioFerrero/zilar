/**
 * A pasted invite link `…/invite/<code>` is reduced to its code; anything else
 * (a bare code, with any surrounding whitespace) is kept as typed.
 */
export function parseInviteCode(raw: string): string {
  const trimmed = raw.trim();
  const match = /\/invite\/([^/?#\s]+)/.exec(trimmed);
  return match?.[1] ?? trimmed;
}
