export function parseInviteCode(raw: string): string {
  const trimmed = raw.trim();
  const match = /\/invite\/([^/?#\s]+)/.exec(trimmed);
  return match?.[1] ?? trimmed;
}
