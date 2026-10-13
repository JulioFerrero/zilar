/**
 * Telegram-style sender colours for group bubbles and reply quotes: seven
 * colours, all readable on the dark incoming bubble (`#161616`, contrast
 * ≥ 4.5:1 like `ui-style.md` §7). A sender keeps one colour everywhere because
 * the pick is a stable hash of the bare JID. Own messages have no colour; they
 * use the accent instead.
 */
export const SENDER_COLORS = [
  '#e17076',
  '#faa774',
  '#a695e7',
  '#7bc862',
  '#6ec9cb',
  '#65aadd',
  '#ee7aae',
] as const;

/** Picks a sender colour deterministically from a bare JID (FNV-1a hash). */
export function senderColor(id: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return SENDER_COLORS[(hash >>> 0) % SENDER_COLORS.length] ?? SENDER_COLORS[0];
}
